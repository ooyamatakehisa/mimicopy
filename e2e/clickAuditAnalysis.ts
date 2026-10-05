import type { ClickAuditCapture } from "./clickAuditSignal";

export function detectClickAuditPulses(samples: Float32Array, sampleRate: number, threshold = 0.0005) {
  const onsets: number[] = [];
  let lastActive = -Infinity;
  for (let index = 0; index < samples.length; index++) {
    if (Math.abs(samples[index]) < threshold) continue;
    if (index - lastActive > sampleRate * 0.12) onsets.push(index);
    lastActive = index;
  }
  return onsets;
}

function decode(value: string) {
  const bytes = Buffer.from(value, "base64");
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

export function analyzeClickAudit(capture: ClickAuditCapture) {
  const streams = Object.fromEntries(Object.entries(capture.pcm).map(([key, value]) => [key, decode(value)]));
  const invalid = Object.values(streams).some((stream) => stream.length !== capture.frames || stream.some((value) => !Number.isFinite(value)));
  const keys = ["nativeLeft", "musicLeft", "clickLeft"] as const;
  const detected = Object.fromEntries(keys.map((key) => [key, detectClickAuditPulses(streams[key], capture.sampleRate)]));
  const onsets = Object.fromEntries(keys.map((key) => [key, detected[key].map((frame) => ({
    frame, offsetMs: frame / capture.sampleRate * 1000, contextTime: capture.startContextTime + frame / capture.sampleRate
  }))]));
  // Retain ordinal pairs and all raw onsets, so a missing first beat cannot be
  // silently matched to its neighbor and made to appear aligned.
  const count = Math.min(...keys.map((key) => detected[key].length));
  const pairs = Array.from({ length: count }, (_, index) => ({
    ordinal: index,
    nativeContextTime: onsets.nativeLeft[index].contextTime,
    musicContextTime: onsets.musicLeft[index].contextTime,
    clickContextTime: onsets.clickLeft[index].contextTime,
    musicMinusNativeMs: (detected.musicLeft[index] - detected.nativeLeft[index]) / capture.sampleRate * 1000,
    clickMinusNativeMs: (detected.clickLeft[index] - detected.nativeLeft[index]) / capture.sampleRate * 1000,
    clickMinusMusicMs: (detected.clickLeft[index] - detected.musicLeft[index]) / capture.sampleRate * 1000
  }));
  const counts = Object.fromEntries(keys.map((key) => [key, detected[key].length]));
  const unmatched = new Set(Object.values(counts)).size !== 1;
  const status = invalid || count < 6 || unmatched || capture.routing.musicDestinationNodes !== 1 || capture.routing.sourceElements !== 1
    ? "inconclusive" : pairs.some((pair) => Math.abs(pair.clickMinusMusicMs) > 20) ? "failed" : "passed";
  const summarize = (values: number[]) => values.length ? {
    minimum: Math.min(...values), maximum: Math.max(...values), mean: values.reduce((sum, value) => sum + value, 0) / values.length
  } : null;
  return {
    status, invalid, counts, unmatched, pairs, onsets,
    method: "Ordinal pulse onsets above absolute 0.0005 with 120 ms quiet separation. All streams retain one worklet sample clock. Missing/unequal pulse counts are inconclusive, never passes. Positive click-minus-music means the click is late. Fixture and click attack shapes differ; sub-millisecond detector bias is not corrected.",
    alignmentThresholdMs: 20,
    musicMinusNativeMs: summarize(pairs.map((pair) => pair.musicMinusNativeMs)),
    clickMinusNativeMs: summarize(pairs.map((pair) => pair.clickMinusNativeMs)),
    clickMinusMusicMs: summarize(pairs.map((pair) => pair.clickMinusMusicMs))
  };
}
