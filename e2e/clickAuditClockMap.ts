import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ClickAuditCapture, ClickAuditClock } from "./clickAuditSignal";

type IdentifiedReport = { pairs: Array<{ beatTime: number; nativeContextTime: number;
  musicMinusNativeMs: number | null; clickMinusMusicMs: number | null }> };

const summarize = (values: number[]) => values.length ? {
  count: values.length, minimum: Math.min(...values), maximum: Math.max(...values),
  median: [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)],
  mean: values.reduce((sum, value) => sum + value, 0) / values.length
} : null;

/** Diagnostic only: observed clock mapping is not a correction or acceptance waiver. */
export function analyzeClickClockMapping(capture: ClickAuditCapture, report: IdentifiedReport) {
  const advancing = capture.clocks.filter((clock, index, clocks): clock is ClickAuditClock & { mediaTime: number; rate: number } => {
    const previous = clocks[index - 1];
    if (!previous || previous.mediaTime === null || clock.mediaTime === null || clock.rate === null ||
      clock.paused || previous.paused || clock.rate !== previous.rate || clock.contextTime <= previous.contextTime) return false;
    const observedRate = (clock.mediaTime - previous.mediaTime) / (clock.contextTime - previous.contextTime);
    return Math.abs(observedRate / clock.rate - 1) < .15;
  });
  const pairs = report.pairs.map((pair) => {
    const nearby = advancing.filter((clock) => Math.abs(clock.contextTime - pair.nativeContextTime) < .12);
    return { ...pair, clockSamples: nearby.length,
      predictedSourceMinusActualMs: summarize(nearby.map((clock) =>
        (clock.contextTime + (pair.beatTime - clock.mediaTime) / clock.rate - pair.nativeContextTime) * 1000)),
      nativeMediaAtActualPulse: summarize(nearby.map((clock) =>
        clock.mediaTime + (pair.nativeContextTime - clock.contextTime) * clock.rate)) };
  });
  const steady = pairs.filter((pair) => pair.beatTime >= 1);
  return {
    method: "For each identified native PCM pulse, use nearby advancing media/context samples (within 120 ms, measured slope within 15% of playbackRate) to predict contextTime+(beat−mediaTime)/rate. Positive prediction−PCM means the media clock lags the actual rendered source. This is an observed mapping diagnostic, not compensation and not a gate override. Steady summary excludes beats before 1s.",
    sampleRate: capture.sampleRate,
    baseLatencyMs: [...new Set(capture.clocks.flatMap((clock) => clock.baseLatency === null ? [] : [clock.baseLatency * 1000]))],
    outputLatencyMs: [...new Set(capture.clocks.flatMap((clock) => clock.outputLatency === null ? [] : [clock.outputLatency * 1000]))],
    renderMinusOutputTimestampMs: summarize(capture.clocks.flatMap((clock) => clock.outputTimestamp
      ? [(clock.contextTime - clock.outputTimestamp.contextTime) * 1000] : [])),
    steadyPredictedSourceMinusActualMs: summarize(steady.flatMap((pair) => pair.predictedSourceMinusActualMs
      ? [pair.predictedSourceMinusActualMs.median] : [])),
    steadyClickMinusMusicMs: summarize(steady.flatMap((pair) => pair.clickMinusMusicMs === null ? [] : [pair.clickMinusMusicMs])),
    pairs
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) for (const filename of process.argv.slice(2)) {
  const capture = JSON.parse(await readFile(filename, "utf8")) as ClickAuditCapture;
  const identity = JSON.parse(await readFile(filename.replace(/\.json$/, "-identity.json"), "utf8")) as IdentifiedReport;
  const report = analyzeClickClockMapping(capture, identity);
  await writeFile(filename.replace(/\.json$/, "-clock-map.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ filename, outputLatencyMs: report.outputLatencyMs,
    renderMinusOutputTimestampMs: report.renderMinusOutputTimestampMs,
    steadyPredictedSourceMinusActualMs: report.steadyPredictedSourceMinusActualMs,
    steadyClickMinusMusicMs: report.steadyClickMinusMusicMs }));
}
