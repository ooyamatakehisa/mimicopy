import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { compareAuditFindings, evaluateAudioAudit, evaluateAuditKeyboard, type AuditFinding, type AuditRun } from "./audioAuditGate";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { baseline: { type: "string" } } });
if (positionals.length !== 1) throw new Error("Usage: pnpm audio:audit:check <output-directory> [--baseline=<previous-directory>]");
const directory = path.resolve(positionals[0]);
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

async function inspect(folder: string) {
  const files = (await readdir(folder)).filter((file) => file.endsWith(".json"));
  const runs: ReturnType<typeof evaluateAudioAudit>[] = [];
  const failures: AuditFinding[] = [];
  const inconclusive: AuditFinding[] = [];
  const addIncomplete = (file: string, reason: string) => inconclusive.push({ key: `${file}/${reason}`, reason });
  let calibrationPassed = false;
  let pitchCalibrationPassed = false;
  let requiresPitchCalibration = false;
  let stereoCalibrationPassed = false;
  let discriminatorCalibrationPassed = false;
  let requiresDiscriminatorCalibration = false;
  let varispeedCalibrationPassed = false;
  let requiresVarispeedCalibration = false;
  for (const file of files) {
    if (file.includes("summary") || file.startsWith("edge-")) continue;
    try {
      const parsed: unknown = JSON.parse(await readFile(path.join(folder, file), "utf8"));
      if (file === "signal-calibration.json") {
        varispeedCalibrationPassed = object(parsed) && parsed.passed === true &&
          parsed.envelopeEstimator === "power-mean-4-v1" && Array.isArray(parsed.varispeedCalibration) &&
          parsed.varispeedCalibration.length === 104;
        discriminatorCalibrationPassed = object(parsed) && Array.isArray(parsed.discriminatorCalibration) && parsed.discriminatorCalibration.length === 93;
        stereoCalibrationPassed = object(parsed) && Array.isArray(parsed.stereoCalibration) && parsed.stereoCalibration.length === 3;
        pitchCalibrationPassed = object(parsed) && Array.isArray(parsed.pitchCalibration) && parsed.pitchCalibration.length === 2;
        calibrationPassed = object(parsed) && parsed.passed === true && Array.isArray(parsed.cases) && parsed.cases.length === 22;
      } else if (file.endsWith("-keyboard.json")) {
        const keyboard = evaluateAuditKeyboard(parsed, file.split("-")[0]);
        failures.push(...keyboard.failures); inconclusive.push(...keyboard.inconclusive);
      } else {
        if (!object(parsed) || typeof parsed.runId !== "string" || !Array.isArray(parsed.cases) || !Array.isArray(parsed.errors)) {
          addIncomplete(file, "unrecognized-or-malformed-report"); continue;
        }
        requiresPitchCalibration ||= parsed.protocol === "mimicopy-audio-audit-v2";
        requiresDiscriminatorCalibration ||= parsed.cases.some((entry: unknown) =>
          object(entry) && object(entry.signal) && object(entry.signal.stereoEvidence));
        requiresVarispeedCalibration ||= parsed.cases.some((entry: unknown) =>
          object(entry) && object(entry.signal) && entry.signal.envelopeEstimator === "power-mean-4-v1");
        const run = evaluateAudioAudit(parsed as AuditRun);
        runs.push(run); failures.push(...run.failures); inconclusive.push(...run.inconclusive);
        if (/^(chromium|webkit)/.test(run.run) && !files.includes(`${run.run}-keyboard.json`)) addIncomplete(file, "missing-keyboard-report");
      }
    } catch (error) { addIncomplete(file, `unreadable-report: ${error instanceof Error ? error.message : String(error)}`); }
  }
  if (!calibrationPassed) addIncomplete("calibration", "missing-or-failed-22-case-calibration");
  if (requiresPitchCalibration && !pitchCalibrationPassed) addIncomplete("calibration", "missing-transposed-carrier-calibration");
  if (requiresPitchCalibration && !stereoCalibrationPassed) addIncomplete("calibration", "missing-stereo-carrier-calibration");
  if (requiresDiscriminatorCalibration && !discriminatorCalibrationPassed) addIncomplete("calibration", "missing-stereo-transient-discriminator-calibration");
  if (requiresVarispeedCalibration && !varispeedCalibrationPassed) addIncomplete("calibration", "missing-104-case-varispeed-envelope-calibration");
  if (!runs.length) addIncomplete("run", "no-application-captures");
  const signatures = runs.map((run) => `${run.engine}/${run.suite}`);
  if (new Set(signatures).size !== signatures.length) addIncomplete("run", "duplicate-engine-suite-runs-use-a-fresh-directory");
  if (files.includes("run-summary.json")) {
    try {
      const manifest: unknown = JSON.parse(await readFile(path.join(folder, "run-summary.json"), "utf8"));
      if (!object(manifest) || !Array.isArray(manifest.errors) || !Array.isArray(manifest.expectedRuns)) {
        addIncomplete("runner", "invalid-run-manifest");
      } else {
        if (manifest.errors.length) addIncomplete("runner", "one-or-more-processes-failed");
        if (manifest.expectedRuns.length !== signatures.length || manifest.expectedRuns.some((key) => !signatures.includes(String(key)))) addIncomplete("runner", "planned-browser-suite-missing");
      }
    } catch { addIncomplete("runner", "unreadable-run-manifest"); }
  }
  return { runs, failures, inconclusive, calibrationPassed };
}

const result = await inspect(directory);
let comparison = null;
if (values.baseline) {
  const baselineDirectory = path.resolve(values.baseline);
  const baseline = await inspect(baselineDirectory);
  const shared = new Set(result.runs.map((run) => `${run.engine}/${run.suite}`));
  const baselineSignatures = new Set(baseline.runs.map((run) => `${run.engine}/${run.suite}`));
  const comparable = [...shared].filter((key) => baselineSignatures.has(key));
  const keysFor = (entries: AuditFinding[]) => entries.filter((entry) => comparable.some((prefix) => entry.key.startsWith(`${prefix}/`)));
  const warnings: string[] = [];
  if (!comparable.length) warnings.push("No matching engine/suite exists; zero differences do not establish improvement.");
  try {
    const currentManifest = JSON.parse(await readFile(path.join(directory, "run-summary.json"), "utf8")) as { protocol: string; hashes: Record<string, string> };
    const baselineManifest = JSON.parse(await readFile(path.join(baselineDirectory, "run-summary.json"), "utf8")) as { protocol: string; hashes: Record<string, string> };
    if (currentManifest.protocol !== baselineManifest.protocol || Object.keys(currentManifest.hashes).some((key) => currentManifest.hashes[key] !== baselineManifest.hashes[key])) warnings.push("Protocol/probe hashes differ; review measurement changes before interpreting deltas.");
  } catch { warnings.push("Comparable runner metadata is unavailable; measurement equivalence is not established."); }
  comparison = { baseline: baselineDirectory, comparableSuites: comparable, warnings,
    note: "Diagnostic case-key comparison, not a pass waiver or proof of causation; timing varies with system load. Keyboard results are listed separately from per-suite comparisons.",
    failures: compareAuditFindings(keysFor(result.failures), keysFor(baseline.failures)),
    inconclusive: compareAuditFindings(keysFor(result.inconclusive), keysFor(baseline.inconclusive)) };
}
const status = result.inconclusive.length ? "incomplete" : result.failures.length ? "fail" : "pass";
const summary = { protocol: "mimicopy-audio-audit-v2", generatedAt: new Date().toISOString(), status,
  scope: "Captured suites only. Quick is a smoke check, desktop WebKit is not iOS. Edge scenarios remain diagnostic in index.html.", ...result, comparison };
await writeFile(path.join(directory, "gate-summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ status, runs: result.runs.map(({ run, captures }) => ({ run, captures })),
  failures: result.failures.length, inconclusive: result.inconclusive.length,
  comparison: comparison && { comparableSuites: comparison.comparableSuites, introduced: comparison.failures.introduced.length, resolved: comparison.failures.resolved.length, warnings: comparison.warnings },
  report: path.join(directory, "gate-summary.json") }, null, 2));
process.exitCode = status === "pass" ? 0 : status === "fail" ? 1 : 2;
