import assert from "node:assert/strict";
import { compareAuditFindings, evaluateAudioAudit, evaluateAuditKeyboard, type AuditCase, type AuditRun } from "./audioAuditGate";
import type { AudioMeasurement, StereoCarrierEvidence } from "./audioAuditSignal";

const channels = ["original", "stem", "remainder"] as const;
function measurement(): AudioMeasurement {
  return { valid: true, error: null, sampleRate: 48000, frames: 115200, durationMs: 2400,
    blockDurationMs: 128 / 48, expectedPlaybackRate: 1, contextState: "running",
    rms: { original: 0.01, stem: 0.01, remainder: 0.01 }, mixedRms: 0.02,
    mixedToneRms: { original: 0.01, stem: 0.01, remainder: 0.01 },
    pairs: channels.flatMap((first, index) => channels.slice(index + 1).map((second) => ({
      first, second, lagMs: 0, peakCorrelation: 1, zeroLagCorrelation: 1, confidence: "high" as const, reason: null
    }))) };
}
function entry(name: string, muted = false): AuditCase {
  const signal = measurement();
  if (muted) {
    signal.rms = { original: 0, stem: 0, remainder: 0 };
    signal.mixedToneRms = { ...signal.rms }; signal.mixedRms = 0;
    signal.pairs.forEach((pair) => { pair.lagMs = null; pair.confidence = "unmeasurable"; });
  }
  return { category: "calibration", name, mask: muted ? 21 : 0, uiMask: muted ? 21 : 0,
    rate: 1, expectedAudible: channels.map(() => !muted), signal, issues: [] };
}
function quick(): AuditRun {
  return { runId: "chromium-quick-test", complete: true, suiteFinished: true, errors: [], cases: [entry("all audible"), entry("all muted", true)] };
}
const clean = evaluateAudioAudit(quick());
assert.equal(clean.failures.length, 0); assert.equal(clean.inconclusive.length, 0);
const missing = quick(); missing.cases[0].signal.rms.stem = 0; missing.cases[0].signal.mixedToneRms.stem = 0;
assert.ok(evaluateAudioAudit(missing).failures.some((issue) => issue.reason === "stem-missing-output"));
const ignoredMute = quick(); ignoredMute.cases[1].signal.rms.original = 0.01; ignoredMute.cases[1].signal.mixedToneRms.original = 0.01;
assert.ok(evaluateAudioAudit(ignoredMute).failures.some((issue) => issue.reason === "original-unexpected-output"));
const leakage = quick(); leakage.cases[1].signal.mixedToneRms.stem = 0.00016;
assert.equal(evaluateAudioAudit(leakage).failures.length, 0, "Spectral leakage without a source signal is not a confirmed mute failure");
const uncertain = quick(); uncertain.cases[0].signal.pairs[0].lagMs = null; uncertain.cases[0].signal.pairs[0].confidence = "low";
assert.ok(evaluateAudioAudit(uncertain).inconclusive.some((issue) => issue.reason.includes("signal-lag-unmeasurable")));
const drift = quick(); drift.cases[0].signal.pairs[0].lagMs = 35;
assert.ok(evaluateAudioAudit(drift).failures.some((issue) => issue.reason.includes("signal-lag-over-20ms")));
const propertyOnly = quick(); propertyOnly.cases[0].issues = ["media-clock-spread-over-20ms", "stem-media-volume-property-mismatch"];
assert.equal(evaluateAudioAudit(propertyOnly).failures.length, 0, "Clock/property warnings are not a substitute for actual output evidence");
const unfinished = quick(); unfinished.suiteFinished = false;
assert.ok(evaluateAudioAudit(unfinished).inconclusive.length);
const absent = quick(); absent.cases.pop();
assert.ok(evaluateAudioAudit(absent).inconclusive.length);

const full = quick(); full.runId = "chromium-full-test";
for (const rate of [1, 0.75, 0.5, 0.25]) for (let mask = 0; mask < 64; mask++) full.cases.push({ ...entry(`state ${mask} at ${rate}x`, true), category: "state-matrix", mask, uiMask: mask, rate });
for (let from = 0; from < 64; from++) for (let bit = 0; bit < 6; bit++) full.cases.push({ ...entry(`${from} -> ${from ^ (1 << bit)}, bit ${bit}`, true), category: "button-transition" });
for (const category of ["paused-state", "resume-state", "seek-state"]) for (let mask = 0; mask < 64; mask++) full.cases.push({ ...entry(String(mask), true), category, mask, uiMask: mask });
for (const rate of [1, 0.75, 0.5, 0.25]) {
  for (const name of [`baseline ${rate}x`, `after rapid 48 state assignments ${rate}x`, `after forward/back seek ${rate}x`]) full.cases.push({ ...entry(name, true), category: "signal-sync" });
  full.cases.push({ ...entry(`stem +100ms, after 2s recovery at ${rate}x`, true), category: "injected-drift" });
}
for (const name of ["natural end pauses all sources", "replay after natural end"]) full.cases.push({ ...entry(name, true), category: "end" });
assert.equal(full.cases.length, 852);
assert.equal(evaluateAudioAudit(full).inconclusive.length, 0);
const sharedFull = structuredClone(full);
sharedFull.protocol = "mimicopy-audio-audit-v2";
for (const item of sharedFull.cases) item.signal.stereo = {
  left: { ...item.signal.rms }, right: { ...item.signal.rms },
  rightCarriersInLeft: { original: 0, stem: 0, remainder: 0 },
  leftCarriersInRight: { original: 0, stem: 0, remainder: 0 }
};
for (const item of sharedFull.cases) if (item.category === "injected-drift") {
  item.category = "shared-seek";
  item.name = item.name.replace("stem +100ms, after 2s recovery", "shared +100ms, after 2s");
}
assert.equal(evaluateAudioAudit(sharedFull).inconclusive.length, 0);
const wrongShared = structuredClone(sharedFull);
wrongShared.cases.find((item) => item.category === "shared-seek")!.issues.push("shared-transport-wrong-playback-rate");
assert.ok(evaluateAudioAudit(wrongShared).failures.length, "New shared seeks are gated, not waived as old injected drift");
const swapped = structuredClone(sharedFull);
swapped.cases[0].signal.stereo!.rightCarriersInLeft.original = 0.01;
assert.ok(evaluateAudioAudit(swapped).inconclusive.some((item) => item.reason === "original-stereo-spectral-candidate"),
  "Legacy FFT-only cross-band energy needs corroboration, not a false confirmed routing failure");
const absentCarrier = (): StereoCarrierEvidence => ({ rawCandidate: false, windowCandidate: false,
  classification: "below-threshold", rawBandRms: 0, guardRms: 0, prominenceDb: null,
  corroboratedWindows: 0, windows: [] });
swapped.cases[0].signal.stereoEvidence = {
  detector: "guard-coherence-v1", candidateThresholdRms: 0.00015,
  minimumProminenceDb: 6, minimumReferenceCoherence: 0.8,
  rightCarriersInLeft: { original: { ...absentCarrier(), rawCandidate: true, windowCandidate: true,
    classification: "carrier-like", rawBandRms: 0.01, corroboratedWindows: 1 }, stem: absentCarrier(), remainder: absentCarrier() },
  leftCarriersInRight: { original: absentCarrier(), stem: absentCarrier(), remainder: absentCarrier() }
};
assert.ok(evaluateAudioAudit(swapped).failures.some((item) => item.reason === "original-stereo-crosstalk"));
swapped.cases[0].signal.stereoEvidence.rightCarriersInLeft.original.classification = "broadband-candidate";
assert.equal(evaluateAudioAudit(swapped).failures.length, 0);
assert.ok(evaluateAudioAudit(swapped).inconclusive.some((item) => item.reason === "original-stereo-spectral-candidate"),
  "Broadband artifacts remain inconclusive until the retained waveform is investigated");
swapped.cases[0].signal.stereo!.rightCarriersInLeft.original = 0.0001;
swapped.cases[0].signal.stereoEvidence.rightCarriersInLeft.original.rawCandidate = false;
assert.ok(evaluateAudioAudit(swapped).inconclusive.length, "A short per-window candidate must not vanish in the average");
const missingSide = structuredClone(sharedFull);
missingSide.cases[0].signal.stereo!.right.original = 0;
assert.ok(evaluateAudioAudit(missingSide).failures.some((item) => item.reason === "original-right-missing-output"));
const missingPitch = quick();
missingPitch.protocol = "mimicopy-audio-audit-v2";
missingPitch.cases[0].category = "long-state-sync";
assert.ok(evaluateAudioAudit(missingPitch).inconclusive.some((item) => item.key.includes("transpose")));
const duplicate = structuredClone(full);
duplicate.cases[3] = structuredClone(duplicate.cases[2]);
assert.ok(evaluateAudioAudit(duplicate).inconclusive.some((issue) => issue.key.includes("state-matrix")), "Counts alone must not pass duplicated state coverage");
const droppedEdge = structuredClone(full);
const edge = droppedEdge.cases.find((candidate) => candidate.category === "button-transition");
assert.ok(edge); edge.name = "unknown transition";
assert.ok(evaluateAudioAudit(droppedEdge).inconclusive.some((issue) => issue.key.includes("button-transition")));
const nan = quick(); nan.cases[0].signal.rms.original = Number.NaN;
assert.ok(evaluateAudioAudit(nan).inconclusive.some((issue) => issue.reason === "original-invalid-rms"));
assert.deepEqual(compareAuditFindings([{ key: "new", reason: "new" }, { key: "same", reason: "same" }], [{ key: "old", reason: "old" }, { key: "same", reason: "same" }]), { introduced: ["new"], resolved: ["old"], retained: ["same"] });
const keyboard = ["原音", "ギター", "ギター以外"].flatMap((label) => ["ミュート", "ソロ"].flatMap((action) => ["Enter", "Space"].map((key) => ({ label, action, key, toggled: true, playingBefore: false, playing: false, unexpectedPlaybackChange: false }))));
assert.deepEqual(evaluateAuditKeyboard(keyboard, "test"), { failures: [], inconclusive: [] });
assert.equal(evaluateAuditKeyboard(keyboard.map(({ playingBefore: _, unexpectedPlaybackChange: __, ...legacy }) => legacy), "test").inconclusive.length, 12, "Legacy evidence does not prove absence of transport interference");
keyboard[0].playing = true;
assert.ok(evaluateAuditKeyboard(keyboard, "test").failures.some((issue) => issue.reason === "keyboard-button-changed-playback"));
console.log("Audio audit gate self-checks passed: output evidence, leakage, inconclusive lag, coverage, and baseline differences.");
