import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { availableParallelism, freemem, loadavg, totalmem } from "node:os";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: {
  quick: { type: "boolean", default: false }, engine: { type: "string", default: "all" },
  output: { type: "string" }, port: { type: "string", default: "8197" }, baseline: { type: "string" }
} });
if (!["all", "chromium", "webkit"].includes(values.engine)) throw new Error("--engine must be all, chromium, or webkit");
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("--port must be an integer from 1024 to 65535");
const startedAt = new Date().toISOString();
const hostLoad = () => ({ loadAverage: loadavg(), availableParallelism: availableParallelism(), freeMemoryBytes: freemem(), totalMemoryBytes: totalmem() });
const output = path.resolve(values.output ?? `audio-audit.local/${startedAt.replace(/[:.]/g, "-")}`);
await mkdir(output, { recursive: true });
if ((await readdir(output)).length) throw new Error("Choose an empty output directory; previous evidence is never overwritten.");
const engines = values.engine === "all" ? ["chromium", "webkit"] : [values.engine];
const plans = values.quick ? [{ suite: "quick", format: "wav" }] : [{ suite: "full", format: "wav" }, { suite: "additional", format: "mp3" }];
const probeFiles = ["audioAuditSignal.ts", "audioAuditFixtures.ts", "audioAuditBrowser.ts", "audioAuditAdditionalBrowser.ts", "audioAuditGate.ts"];
const hashes = Object.fromEntries(await Promise.all(probeFiles.map(async (file) => [file, createHash("sha256").update(await readFile(path.join("e2e", file))).digest("hex")])));
const applicationFiles = [...new Set(execFileSync("git", ["ls-files", "-co", "--exclude-standard", "src", "server"],
  { encoding: "utf8" }).trim().split("\n"))].filter((file) => file && !/\.test\./.test(file)).sort();
const applicationHash = createHash("sha256");
for (const file of applicationFiles) applicationHash.update(file).update(await readFile(file));
const manifest = {
  protocol: "mimicopy-audio-audit-v2", startedAt, finishedAt: "", profile: values.quick ? "quick" : "full",
  expectedRuns: plans.flatMap((plan) => engines.map((engine) => `${engine}/${plan.suite}`)),
  revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  gitStatus: execFileSync("git", ["status", "--short"], { encoding: "utf8" }).trim(),
  applicationHash: applicationHash.digest("hex"),
  node: process.version, platform: process.platform, architecture: process.arch, hashes,
  hostLoadAtStart: hostLoad(), hostLoadAtEnd: null as ReturnType<typeof hostLoad> | null,
  execution: "Browsers and suites run sequentially; avoid other audio audits or CPU-heavy jobs during measurement.",
  errors: [] as string[]
};
// Preserve the actual revision/hashes even if the host terminates the runner
// before its finally block. An empty finishedAt marks interrupted evidence.
await writeFile(path.join(output, "run-summary.json"), JSON.stringify(manifest, null, 2));
const children = new Set<ChildProcess>();
let interrupted = false;
const interrupt = () => { interrupted = true; for (const child of children) child.kill("SIGTERM"); };
process.on("SIGINT", interrupt); process.on("SIGTERM", interrupt);

function launch(script: string, args: string[], environment: NodeJS.ProcessEnv, logName: string) {
  if (interrupted) throw new Error("Audio audit interrupted");
  const log = createWriteStream(path.join(output, `${logName}.log`), { flags: "a" });
  const child = spawn(process.execPath, ["--import", "tsx", `e2e/${script}.ts`, ...args], {
    env: { ...process.env, MIMICOPY_AUDIO_AUDIT_OUTPUT: output, MIMICOPY_AUDIO_AUDIT_PORT: String(port), ...environment },
    stdio: ["ignore", "pipe", "pipe"]
  });
  children.add(child);
  child.stdout?.pipe(log, { end: false }); child.stderr?.pipe(log, { end: false });
  const done = new Promise<number>((resolve) => {
    child.on("error", (error) => { log.write(`${error.message}\n`); resolve(2); });
    child.on("close", (code) => { children.delete(child); log.end(); resolve(code ?? 2); });
  });
  return { child, done };
}

async function command(script: string, args: string[] = [], environment: NodeJS.ProcessEnv = {}, logName = script) {
  const { done } = launch(script, args, environment, logName);
  const code = await done;
  if (code) throw new Error(`${logName} exited ${code}; see ${logName}.log`);
}

async function startServer(environment: NodeJS.ProcessEnv, logName: string) {
  const process = launch("audioAuditServer", [], environment, logName);
  try {
    await new Promise<void>((resolve, reject) => {
      let tail = "";
      const timer = setTimeout(() => reject(new Error("Audio audit server did not become ready within 60 seconds")), 60000);
      process.child.stdout?.on("data", (chunk: Buffer) => {
        tail = (tail + chunk.toString()).slice(-2000);
        if (tail.includes(`Audio audit: http://127.0.0.1:${port}/`)) { clearTimeout(timer); resolve(); }
      });
      void process.done.then((code) => { clearTimeout(timer); reject(new Error(`Audit server exited ${code} before use; see ${logName}.log`)); });
    });
    return process;
  } catch (error) { process.child.kill("SIGTERM"); await process.done; throw error; }
}

async function stopServer(server: ReturnType<typeof launch>) {
  server.child.kill("SIGTERM");
  const timer = setTimeout(() => server.child.kill("SIGKILL"), 2000);
  await server.done; clearTimeout(timer);
}

console.log(`Audio audit output: ${output}`);
try {
  await command("audioAuditGateCheck");
  await command("audioAuditCalibration");
  for (const plan of plans) {
    const environment = { MIMICOPY_AUDIO_AUDIT_FORMAT: plan.format, MIMICOPY_AUDIO_AUDIT_SUITE: plan.suite === "additional" ? "additional" : "full" };
    const server = await startServer(environment, `server-${plan.suite}`);
    try {
      for (const engine of engines) {
        console.log(`Measuring ${engine}/${plan.suite}…`);
        const flags = plan.suite === "quick" ? ["--quick"] : plan.suite === "additional" ? ["--additional"] : [];
        try { await command("audioAuditDesktop", [engine, ...flags], environment, `${engine}-${plan.suite}`); }
        catch (error) { manifest.errors.push(String(error)); }
        if (plan.suite === "full" && !interrupted) {
          try { await command("audioAuditEdges", [engine], environment, `${engine}-edges`); }
          catch (error) { manifest.errors.push(String(error)); }
        }
      }
    } finally { await stopServer(server); }
  }
} catch (error) { manifest.errors.push(String(error)); }
finally {
  manifest.finishedAt = new Date().toISOString();
  manifest.hostLoadAtEnd = hostLoad();
  await writeFile(path.join(output, "run-summary.json"), JSON.stringify(manifest, null, 2));
  for (const child of children) child.kill("SIGTERM");
}
if (!interrupted) {
  let reportFailed = false;
  try { await command("audioAuditReport"); }
  catch (error) { reportFailed = true; console.error(String(error)); }
  const { done } = launch("audioAuditCheck", [output, ...(values.baseline ? [`--baseline=${path.resolve(values.baseline)}`] : [])], {}, "audioAuditCheck");
  const checkCode = await done;
  process.exitCode = reportFailed ? 2 : checkCode;
  try {
    const gate = JSON.parse(await readFile(path.join(output, "gate-summary.json"), "utf8")) as { status: string; failures: unknown[]; inconclusive: unknown[] };
    console.log(`${gate.status}: ${gate.failures.length} findings, ${gate.inconclusive.length} incomplete/inconclusive checks`);
  } catch { process.exitCode = 2; }
  console.log(`Report: ${path.join(output, "index.html")}`);
} else process.exitCode = 130;
