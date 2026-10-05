import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeIdentifiedClicks } from "./clickAuditIdentity";
import { analyzeRateClickAudit, type ClickAuditExpectation } from "./clickAuditRateAnalysis";
import { runClickAuditCalibration } from "./clickAuditCheck";
import { runClickRateCalibration } from "./clickAuditRateCheck";
import type { ClickAuditCapture } from "./clickAuditSignal";
import { assessClickAuditCoverage, summarizeClickAuditCoverage, type ClickAuditPlan } from "./clickAuditCoverage";

// Re-evaluate immutable recordings in a NEW directory. Never replace a raw
// recording or its earlier verdict, including false-positive/false-pass evidence.
async function recheck() {
  const arguments_ = process.argv.slice(2);
  const directories = arguments_.filter((argument) => !argument.startsWith("--"));
  const outputName = arguments_.find((argument) => argument.startsWith("--output-name="))?.slice(14) ?? "strict-recheck";
  const expectedTotalText = arguments_.find((argument) => argument.startsWith("--expected-total="))?.slice(17);
  const expectedTotal = expectedTotalText === undefined ? null : Number(expectedTotalText);
  const expectedNativeNames = arguments_.find((argument) => argument.startsWith("--expected-native="))?.slice(18).split(",") ?? [];
  if (!directories.length || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(outputName)) {
    throw new Error("Usage: tsx e2e/clickAuditRecheck.ts DIRECTORY... [--output-name=new-name]");
  }
  if (expectedTotal !== null && (!Number.isSafeInteger(expectedTotal) || expectedTotal < 1)) throw new Error("Expected total must be a positive integer.");
  if (expectedNativeNames.some((name) => !/^[A-Za-z0-9_-]+$/.test(name))) throw new Error("Expected native names must be comma-separated basenames without .json.");
  const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
  const calibrations = { identity: runClickAuditCalibration(), rates: runClickRateCalibration() };
  const sourceNames = ["clickAuditRecheck.ts", "clickAuditStart.ts", "clickAuditIdentity.ts", "clickAuditRateAnalysis.ts",
    "clickAuditCheck.ts", "clickAuditRateCheck.ts", "clickAuditAnalysis.ts", "clickAuditFixtures.ts",
    "clickAuditCoverage.ts", "clickAuditClockMap.ts", "clickAuditStereo.ts"].map((filename) => path.join("e2e", filename));
  sourceNames.push("src/lib/clickCueDsp.ts");
  type SavedCapture = ClickAuditCapture & { requestedStartSeconds?: number; expectation?: ClickAuditExpectation; errors?: unknown[]; pageErrors?: unknown[] };
  type Range = { minimum: number; maximum: number; pairs: number };
  const range = (values: number[]): Range | null => values.length ? { minimum: Math.min(...values), maximum: Math.max(...values), pairs: values.length } : null;
  type Measurement = { engine: string; rate: number | null; musicSynchronizationMeasured: boolean; centroidMs: Range | null; leadingMs: Range | null;
    rightCentroidMs: Range | null; exactIdentityMs: Range | null };
  type RecheckRecord = { filename: string; sha256: string; status: string; failures?: string[]; inconclusive?: string[];
    error?: string; start?: ReturnType<typeof analyzeIdentifiedClicks>["start"]; requestedStartOrigin?: string;
    expectation?: ClickAuditExpectation; analysis?: string; measurement?: Measurement };
  const allRecords: Array<RecheckRecord & { directory: string }> = [];
  const directoryResults: Array<{ input: string; output: string; recorded: number; passed: number; failed: number; inconclusive: number; missing: number }> = [];
  for (const directory of directories) {
    const input = path.resolve(directory), output = path.join(input, outputName);
    await mkdir(output); // EEXIST deliberately refuses to overwrite earlier evidence.
    const sources = await Promise.all(sourceNames.map(async (filename) => {
      const source = await readFile(filename);
      await writeFile(path.join(output, path.basename(filename)), source, { flag: "wx" });
      return { filename, sha256: sha256(source) };
    }));
    const fixture = await readFile(path.join(input, "click-pulses.wav"));
    const records: RecheckRecord[] = [];
    const plans: ClickAuditPlan[] = [];
    const planProvenance: Array<{ filename: string; origin: string; sha256: string }> = [];
    const readOptionalJson = async (filename: string) => {
      try {
        const text = await readFile(path.join(input, filename), "utf8");
        const value: unknown = JSON.parse(text);
        return { value, sha256: sha256(text) };
      } catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
        return null;
      }
    };
    for (const [planFilename, summaryFilename] of [["click-rate-plan.json", "click-rate-summary.json"], ["click-plan.json", "click-summary.json"]]) {
      const plan = await readOptionalJson(planFilename), summary = plan ? null : await readOptionalJson(summaryFilename);
      const evidence = plan ?? summary;
      if (!evidence) continue;
      const value = evidence.value as { expected?: unknown; names?: unknown; plannedCaptures?: unknown; counts?: { expected?: unknown }; summaries?: Array<{ name?: unknown }> };
      const expected = plan ? value.expected : value.counts?.expected;
      const names = plan ? value.names : value.plannedCaptures ?? value.summaries?.map((item) => item.name);
      if (typeof expected !== "number" || !Number.isSafeInteger(expected) || expected < 0 || !Array.isArray(names) || !names.every((name): name is string => typeof name === "string")) {
        throw new Error(`Invalid planned scenario evidence in ${plan ? planFilename : summaryFilename}.`);
      }
      plans.push({ expected, names: [...new Set(names)] });
      planProvenance.push({ filename: plan ? planFilename : summaryFilename, sha256: evidence.sha256,
        origin: plan || value.plannedCaptures ? "explicit planned names" : "names preserved in historical summary; unnamed expected cases remain missing" });
    }
    const executionErrors: Array<{ filename: string; sha256: string; report: unknown }> = [];
    for (const filename of (await readdir(input)).filter((name) => name.endsWith(".json")).sort()) {
      const rawText = await readFile(path.join(input, filename), "utf8");
      let value: unknown;
      try { value = JSON.parse(rawText); }
      catch (error) {
        executionErrors.push({ filename, sha256: sha256(rawText), report: { status: "inconclusive", error: `Invalid saved JSON: ${String(error)}` } });
        continue;
      }
      if (!value || typeof value !== "object" || !("protocol" in value) || value.protocol !== "mimicopy-click-pcm-v1") {
        if (/^(chromium|webkit|ios27)-.*-error\.json$/.test(filename)) executionErrors.push({ filename, sha256: sha256(rawText), report: value });
        continue;
      }
      const rawSha256 = sha256(rawText);
      try {
        const capture = value as SavedCapture;
        let requestedStartSeconds = capture.requestedStartSeconds;
        let requestedStartOrigin = requestedStartSeconds === undefined ? "observed paused cursor; no recorded requested target" : "explicit raw requestedStartSeconds";
        // Historical desktop runner scenarios have fixed UI marker intents. This
        // is derived metadata, not a claim that the original raw recorded intent.
        if (requestedStartSeconds === undefined && /^(chromium|webkit)-/.test(filename)) {
          if (/-(seek5\.2|click-toggle|all-music-muted)\.json$/.test(filename)) requestedStartSeconds = 5.2;
          else if (filename.endsWith("-seek5.0-boundary.json")) requestedStartSeconds = 5;
          else if (/fresh|warm-replay/.test(filename)) requestedStartSeconds = 0;
          if (requestedStartSeconds !== undefined) requestedStartOrigin = "derived from preserved desktop scenario filename and fixed runner marker contract";
        }
        const expectation: ClickAuditExpectation = capture.expectation ?? { kind: "music-and-click" };
        const supportsRateEstimator = capture.pcm.normalCue !== undefined && capture.pcm.downbeatCue !== undefined;
        const report = supportsRateEstimator ? analyzeRateClickAudit(capture, expectation, requestedStartSeconds)
          : analyzeIdentifiedClicks(capture, fixture, requestedStartSeconds);
        const identityCheck = supportsRateEstimator && expectation.kind === "music-and-click" && capture.clocks.every((clock) => clock.rate === 1)
          ? analyzeIdentifiedClicks(capture, fixture, requestedStartSeconds) : null;
        const browserErrors = [...(capture.errors ?? []), ...(capture.pageErrors ?? [])].map(String);
        const failures = [...new Set([...report.failures, ...(identityCheck?.failures ?? []).map((failure) => `Exact 1x identity: ${failure}`)])];
        const inconclusive = [...report.inconclusive, ...(identityCheck?.inconclusive ?? []).map((reason) => `Exact 1x identity: ${reason}`), ...browserErrors];
        const status = inconclusive.length ? "inconclusive" : failures.length ? "failed" : "passed";
        const analysis = filename.replace(/\.json$/, supportsRateEstimator ? "-strict-rate.json" : "-strict-identity.json");
        const metadata = { input: path.join(input, filename), rawSha256, requestedStartOrigin, requestedStartSeconds: requestedStartSeconds ?? null };
        const exact = identityCheck ?? ("physicalPairs" in report ? report : null);
        const measurement: Measurement = { engine: filename.startsWith("ios27-") ? "ios27-safari" : filename.split("-")[0],
          rate: capture.clocks[0]?.rate ?? null, musicSynchronizationMeasured: expectation.kind !== "all-music-muted",
          centroidMs: "musicSynchronizationMeasured" in report ? range(report.pairs.map((pair) => pair.clickMinusMusicCentroidMs)) : null,
          leadingMs: "musicSynchronizationMeasured" in report ? range(report.pairs.map((pair) => pair.clickMinusMusicLeadingMs)) : null,
          rightCentroidMs: "musicSynchronizationMeasured" in report ? range(report.pairs.flatMap((pair) => pair.clickMinusRightMusicCentroidMs === null ? [] : [pair.clickMinusRightMusicCentroidMs])) : null,
          exactIdentityMs: exact ? range(exact.physicalPairs.flatMap((pair) => pair.clickMinusMusicMs === null ? [] : [pair.clickMinusMusicMs])) : null };
        await writeFile(path.join(output, analysis), JSON.stringify({ ...report, status, failures, inconclusive, identityCheck, recheck: metadata }, null, 2), { flag: "wx" });
        records.push({ filename, sha256: rawSha256, status, failures, inconclusive, start: report.start,
          expectation, requestedStartOrigin, analysis, measurement });
      } catch (error) {
        records.push({ filename, sha256: rawSha256, status: "inconclusive", error: String(error) });
      }
    }
    const coverage = assessClickAuditCoverage(plans, records.map((record) => record.filename.replace(/\.json$/, "")));
    const counts = { recorded: records.length, plannedDesktop: coverage.expected,
      passed: records.filter((record) => record.status === "passed").length,
      failed: records.filter((record) => record.status === "failed").length,
      inconclusive: records.filter((record) => record.status === "inconclusive").length + executionErrors.length + coverage.overlaps.length,
      missing: coverage.missing,
      recordingsWithConfirmedFailures: records.filter((record) => record.failures?.length).length };
    await writeFile(path.join(output, "recheck-summary.json"), JSON.stringify({ input, sources, fixtureSha256: sha256(fixture), calibrations,
      counts, coverage, planProvenance, executionErrors, records,
      limitations: "Reanalysis of discovered raw captures only. Explicit desktop plans or historical summary names supply expected scenarios; unrelated extra recordings cannot substitute for missing names. Native coverage is the discovered native files, not an inferred complete native operation matrix. Original files and earlier verdicts remain unchanged." }, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ output, counts, outcomes: records.map(({ filename, status, failures, inconclusive, error }) => ({ filename, status, failures, inconclusive, error })) }));
    allRecords.push(...records.map((record) => ({ ...record, directory: input })));
    directoryResults.push({ input, output, recorded: counts.recorded, passed: counts.passed, failed: counts.failed,
      inconclusive: counts.inconclusive, missing: counts.missing });
    if (counts.inconclusive || counts.missing || !counts.recorded) process.exitCode = 2;
    else if (counts.failed && process.exitCode !== 2) process.exitCode = 1;
  }
  const coverageTotals = summarizeClickAuditCoverage({
    missingDesktop: directoryResults.reduce((sum, result) => sum + result.missing, 0),
    expectedNativeNames, recordedNames: allRecords.map((record) => record.filename.replace(/\.json$/, "")),
    expectedTotal, recordedTotal: allRecords.length
  });
  const keys = [...new Set(allRecords.flatMap((record) => record.measurement ? [`${record.measurement.engine}/${record.measurement.rate}`] : []))];
  const timingGroups = keys.map((key) => {
    const measurements = allRecords.flatMap((record) => record.measurement && `${record.measurement.engine}/${record.measurement.rate}` === key ? [record.measurement] : []);
      const combine = (field: "centroidMs" | "leadingMs" | "rightCentroidMs" | "exactIdentityMs") => {
      const ranges = measurements.flatMap((measurement) => measurement[field] ? [measurement[field]] : []);
      return ranges.length ? { minimum: Math.min(...ranges.map((item) => item.minimum)), maximum: Math.max(...ranges.map((item) => item.maximum)),
        pairs: ranges.reduce((sum, item) => sum + item.pairs, 0) } : null;
    };
      return { key, captures: measurements.length, centroidMs: combine("centroidMs"), leadingMs: combine("leadingMs"),
        rightCentroidMs: combine("rightCentroidMs"), exactIdentityMs: combine("exactIdentityMs") };
  });
  const nativeArmCoverage = allRecords.filter((record) => record.filename.startsWith("ios27-")).map((record) => ({
    filename: record.filename, directory: record.directory, start: record.start, status: record.status, failures: record.failures, inconclusive: record.inconclusive
  }));
  const totals = { expectedTotal, recorded: allRecords.length, passed: directoryResults.reduce((sum, result) => sum + result.passed, 0),
    failed: directoryResults.reduce((sum, result) => sum + result.failed, 0), inconclusive: directoryResults.reduce((sum, result) => sum + result.inconclusive, 0),
    ...coverageTotals };
  if (coverageTotals.totalCountMismatch || coverageTotals.missing || coverageTotals.unnamedMissing) process.exitCode = 2;
  await writeFile(path.join(directoryResults[0].output, "cross-directory-summary.json"), JSON.stringify({ totals, directoryResults, timingGroups, nativeArmCoverage }, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ totals, timingGroups, nativeArmCoverage }));
}

void recheck().catch((error: unknown) => {
  console.error(JSON.stringify({ status: "inconclusive", error: String(error) }));
  process.exitCode = 2;
});
