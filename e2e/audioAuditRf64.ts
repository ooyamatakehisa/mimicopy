import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, mkdir, open, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServer, type Plugin } from "vite";
import { chromium, webkit } from "@playwright/test";

const directory = path.resolve(process.env.MIMICOPY_RF64_OUTPUT ?? "audio-audit.local/click-cue-rf64-2h-20261005");
const port = Number(process.env.MIMICOPY_RF64_PORT ?? "8203");
const filename = path.join(directory, "fixture-2h.rf64.wav");
const sampleRate = 48_000, channels = 8, duration = 7200, frames = sampleRate * duration, blockAlign = channels * 2;
const header = Buffer.alloc(104), dataBytes = frames * blockAlign;
header.write("RF64", 0); header.writeUInt32LE(0xffffffff, 4); header.write("WAVEds64", 8); header.writeUInt32LE(28, 16);
header.writeBigUInt64LE(BigInt(header.length + dataBytes - 8), 20); header.writeBigUInt64LE(BigInt(dataBytes), 28);
header.writeBigUInt64LE(BigInt(frames), 36); header.writeUInt32LE(0, 44);
header.write("fmt ", 48); header.writeUInt32LE(40, 52); header.writeUInt16LE(0xfffe, 56); header.writeUInt16LE(channels, 58);
header.writeUInt32LE(sampleRate, 60); header.writeUInt32LE(sampleRate * blockAlign, 64); header.writeUInt16LE(blockAlign, 68);
header.writeUInt16LE(16, 70); header.writeUInt16LE(22, 72); header.writeUInt16LE(16, 74); header.writeUInt32LE(0x63f, 76);
Buffer.from("0100000000001000800000aa00389b71", "hex").copy(header, 80); header.write("data", 96); header.writeUInt32LE(0xffffffff, 100);
await mkdir(directory, { recursive: true });
const metadataPath = path.join(directory, "metadata.json");
if (!process.argv.includes("--reuse")) {
  if ((await readdir(directory)).length) throw new Error("Use an empty RF64 lab directory, or --reuse an immutable prepared fixture.");
  const file = await open(filename, "wx");
  const sections: Array<{ startFrame: number; frames: number; sha256: string }> = [];
  try {
    await file.write(header, 0, header.length, 0); await file.truncate(header.length + dataBytes);
    for (const [first, count] of [[0, sampleRate], [(duration - 8) * sampleRate, 8 * sampleRate]]) {
      const data = Buffer.alloc(count * blockAlign);
      for (let frame = 0; frame < count; frame++) {
        const absolute = first + frame;
        for (let channel = 0; channel < 6; channel++) {
          // Deterministic sample identities: independently seeded 16-bit LCG-derived PCM.
          let value = Math.imul(absolute ^ Math.imul(channel + 1, 0x9e3779b9), 1664525) + 1013904223;
          value ^= value >>> 16;
          data.writeInt16LE((value & 8191) - 4096, frame * blockAlign + channel * 2);
        }
        for (const [cue, time] of [[7, 7198.75], [6, 7199.25], [7, 7199.75]]) {
          if (absolute >= time * sampleRate && absolute < time * sampleRate + 48) data.writeInt16LE(32767, frame * blockAlign + cue * 2);
        }
      }
      await file.write(data, 0, data.length, header.length + first * blockAlign);
      sections.push({ startFrame: first, frames: count, sha256: createHash("sha256").update(data).digest("hex") });
    }
  } finally { await file.close(); }
  await writeFile(metadataPath, JSON.stringify({ protocol: "mimicopy-large-rf64-v1", filename, bytes: header.length + dataBytes,
    sampleRate, channels, bitsPerSample: 16, duration, frames, headerBytes: header.length, dataBytes,
    headerSha256: createHash("sha256").update(header).digest("hex"), sections, sparseZeroFrames: [sampleRate, (duration - 8) * sampleRate],
    target: 7198.4, cues: [{ time: 7198.75, channel: 7 }, { time: 7199.25, channel: 6 }, { time: 7199.75, channel: 7 }],
    sourceHashes: Object.fromEntries(await Promise.all(["e2e/audioAuditRf64.ts", "e2e/audioAuditRf64Browser.ts"].map(async (name) => [name, createHash("sha256").update(await readFile(name)).digest("hex")]))),
    scope: "Nonproduction container qualification: sparse actual >4GiB RF64, native HTMLMediaElement→MediaElementSource→8ch worklet; no pitch DSP or React. Silent sparse middle; identity-bearing first second and final8 seconds. Not a whole-song decoding stress test."
  }, null, 2), { flag: "wx" });
}
if ((await stat(filename)).size !== header.length + dataBytes) throw new Error("Unexpected RF64 fixture size.");
if (process.argv.includes("--prepare-only")) { console.log(`Prepared ${filename}`); process.exit(); }
const captureSourceHashes = Object.fromEntries(await Promise.all(["e2e/audioAuditRf64.ts", "e2e/audioAuditRf64Browser.ts"].map(async (name) => [name, createHash("sha256").update(await readFile(name)).digest("hex")])));
const fixtureMetadataSha256 = createHash("sha256").update(await readFile(metadataPath)).digest("hex");
const plugin: Plugin = { name: "large-rf64-lab", configureServer(server) { server.middlewares.use(async (request, response, next) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  if (url.pathname === "/") {
    response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><h1>Two-hour RF64 container test</h1><p>5.53 GB sparse file. Native eight-channel PCM at 7198.4 seconds.</p><button id="prepare" disabled style="font-size:24px;padding:18px">Prepare RF64</button><button id="start" disabled style="font-size:24px;padding:18px">Start capture</button><p id="status">Loading recorder…</p><script type="module" src="/e2e/audioAuditRf64Browser.ts"></script></body></html>'); return;
  }
  if (url.pathname === "/fixture-2h.rf64.wav") {
    const size = header.length + dataBytes, range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
    const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) { response.statusCode = 416; response.end(); return; }
    response.statusCode = range ? 206 : 200; response.setHeader("Accept-Ranges", "bytes"); response.setHeader("Content-Type", "audio/wav");
    response.setHeader("Content-Length", end - start + 1); if (range) response.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
    const stream = createReadStream(filename, { start, end });
    const record = { time: Date.now(), url: url.pathname + url.search, run: url.searchParams.get("run"), userAgent: request.headers["user-agent"],
      requestedRange: request.headers.range ?? null, start, end, size, status: response.statusCode, mime: "audio/wav" };
    response.on("close", () => { stream.destroy(); void appendFile(path.join(directory, "range-requests.jsonl"), `${JSON.stringify({ ...record, bytesRead: stream.bytesRead })}\n`); });
    stream.on("error", () => response.destroy()); stream.pipe(response); return;
  }
  if (url.pathname === "/report" && request.method === "POST") {
    try {
      let size = 0; const chunks: Buffer[] = [];
      for await (const chunk of request) { const bytes = Buffer.from(chunk); size += bytes.length; if (size > 16 * 1024 * 1024) throw new Error("Capture too large"); chunks.push(bytes); }
      const report: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!report || typeof report !== "object" || Array.isArray(report)) throw new Error("Invalid capture object");
      const run = (url.searchParams.get("run") ?? "native-ios-rf64-2h").replace(/[^a-zA-Z0-9_-]/g, "_");
      const outputPath = path.join(directory, `${run}.json`); await writeFile(outputPath, JSON.stringify({ ...report, captureSourceHashes, fixtureMetadataSha256 }), { flag: "wx" });
      response.end(outputPath); console.log(`Saved ${outputPath}`);
    } catch (reason) { response.statusCode = 400; response.end(String(reason)); } return;
  }
  next();
}); } };
const server = await createServer({ configFile: false, plugins: [plugin], server: { host: "127.0.0.1", port, strictPort: true, hmr: false, watch: null } });
await server.listen(); console.log(`RF64 lab ready http://127.0.0.1:${port}/?run=native-ios-rf64-2h`);
for (const name of ["SIGINT", "SIGTERM"] as const) process.on(name, () => { void server.close().then(() => process.exit()); });
if (process.argv.includes("--desktop")) {
  for (const [engine, implementation] of [["chromium", chromium], ["webkit", webkit]] as const) {
    const browser = await implementation.launch(); const page = await browser.newPage(); const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(`http://127.0.0.1:${port}/?run=${engine}-rf64-2h`);
      await page.getByRole("button", { name: "Prepare RF64", exact: true }).click({ timeout: 20_000 });
      await page.getByRole("button", { name: "Start capture", exact: true }).click({ timeout: 20_000 });
      await page.waitForFunction(() => document.querySelector("#status")?.textContent?.startsWith("Saved") || window.__rf64Error, undefined, { timeout: 20_000 });
      const result = await page.evaluate(() => ({ status: document.querySelector("#status")?.textContent, error: window.__rf64Error,
        frames: window.__rf64Result?.frames, sampleRate: window.__rf64Result?.sampleRate, channels: window.__rf64Result?.inputChannelCounts }));
      await writeFile(path.join(directory, `${engine}-control.json`), JSON.stringify({ ...result, pageErrors: errors }), { flag: "wx" }); console.log(JSON.stringify({ engine, ...result, errors }));
    } catch (error) { await writeFile(path.join(directory, `${engine}-control-error.json`), JSON.stringify({ error: String(error), pageErrors: errors }), { flag: "wx" }); }
    finally { await browser.close(); }
  }
  console.log("Desktop captures complete; server remains ready for native Safari.");
}
