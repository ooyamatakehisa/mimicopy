import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ClickCueDsp } from "../src/lib/clickCueDsp";
import { clickAuditPulseFrames, clickAuditPulseFrequency } from "./clickAuditFixtures";
import { analyzeRateClickAudit } from "./clickAuditRateAnalysis";
import type { ClickAuditCapture } from "./clickAuditSignal";
import { assessClickAuditCoverage, summarizeClickAuditCoverage } from "./clickAuditCoverage";

export function createSyntheticRateCapture(rate: number, options: { musicDelayMs?: number; missingFirst?: boolean; corruptIdentity?: boolean;
  startBeat?: number; prefixSeconds?: number; musicMuted?: boolean; clickOff?: { start: number; end: number } } = {}): ClickAuditCapture {
  const fs = 48_000, prefix = Math.round((options.prefixSeconds ?? .3) * fs), latency = Math.round((options.musicDelayMs ?? 120) / 1000 * fs);
  const frames = Math.ceil((1 + 4.5 / rate) * fs);
  const native = new Float32Array(frames), music = new Float32Array(frames);
  const normal = new Float32Array(frames), downbeat = new Float32Array(frames);
  for (let beat = 0; beat < 9; beat++) {
    if (options.missingFirst && beat === 0) continue;
    const start = prefix + Math.round(beat * .5 / rate * fs);
    const width = Math.round(.02 / rate * fs);
    const frequency = clickAuditPulseFrequency(beat + (options.startBeat ?? 0));
    for (let frame = 0; frame < width; frame++) {
      const fixtureFrame = frame * rate;
      const envelope = fixtureFrame <= clickAuditPulseFrames - 1
        ? .08 * (1 - Math.cos(2 * Math.PI * fixtureFrame / (clickAuditPulseFrames - 1))) / 2 : 0;
      native[start + frame] = envelope * Math.sin(2 * Math.PI * frequency * rate * frame / fs);
      if (!options.musicMuted) music[start + latency + frame] = envelope * Math.sin(2 * Math.PI * (frequency + (options.corruptIdentity && beat === 3 ? 32 : 0)) * frame / fs);
    }
    (beat % 4 === 0 ? downbeat : normal).fill(.75, start, start + Math.round(48 / rate));
  }
  const dsp = new ClickCueDsp(fs, .12);
  const click = Float32Array.from(normal, (sample, frame) => dsp.processSample(sample, downbeat[frame],
    !options.clickOff || frame < options.clickOff.start * fs || frame >= options.clickOff.end * fs));
  const encode = (samples: Float32Array) => Buffer.from(samples.buffer).toString("base64");
  return { protocol: "mimicopy-click-pcm-v1", encoding: "float32-le-base64", sampleRate: fs, frames, startContextTime: 0,
    pcm: { nativeLeft: encode(native), nativeRight: encode(native), musicLeft: encode(music), musicRight: encode(music),
      clickLeft: encode(click), clickRight: encode(click), normalCue: encode(normal), downbeatCue: encode(downbeat) },
    clocks: [{ contextTime: 0, performanceTime: 0, state: "running", sampleRate: fs, baseLatency: 0, outputLatency: 0,
      outputTimestamp: null, mediaTime: (options.startBeat ?? 0) / 2, rate, paused: true, readyState: 4 }],
    events: [{ event: "play", performanceTime: 5, contextTime: .005, state: "running", sampleRate: fs,
      baseLatency: 0, outputLatency: 0, outputTimestamp: null, mediaTime: (options.startBeat ?? 0) / 2, rate, paused: false, readyState: 4 }],
    routing: { sourceElements: 1, musicDestinationNodes: 1, clickDestinationNodes: 1 } };
}

export function runClickRateCalibration() {
  const checks: Array<{ name: string; maximumCentroidErrorMs?: number; maximumLeadingErrorMs?: number }> = [];
  for (const rate of [1, .75, .5, .25]) {
    const report = analyzeRateClickAudit(createSyntheticRateCapture(rate));
    assert.equal(report.status, "passed", JSON.stringify({ rate, failures: report.failures, inconclusive: report.inconclusive }));
    assert.equal(report.pairs.length, 9);
    const maximumCentroidErrorMs = Math.max(...report.pairs.map((pair) => Math.abs(pair.musicCentroidDelayMs - 120)));
    const maximumLeadingErrorMs = Math.max(...report.pairs.map((pair) => Math.abs(pair.musicLeadingDelayMs - 120)));
    assert(maximumCentroidErrorMs < 1 && maximumLeadingErrorMs < 2);
    checks.push({ name: `${rate}x independently generated slowed-source/restored-carrier Hann identity and delay`, maximumCentroidErrorMs, maximumLeadingErrorMs });
    for (const musicDelayMs of [95, 145]) {
      const shifted = analyzeRateClickAudit(createSyntheticRateCapture(rate, { musicDelayMs }));
      assert.equal(shifted.status, "failed");
      assert(shifted.failures.some((failure) => failure.includes("±20ms")));
      checks.push({ name: `${rate}x known music ${musicDelayMs - 120}ms shift fails20ms gate` });
    }
  }
  assert.equal(analyzeRateClickAudit(createSyntheticRateCapture(.25, { missingFirst: true })).status, "failed");
  checks.push({ name: "missing first native/music/cue/click beat remains failure" });
  assert.equal(analyzeRateClickAudit(createSyntheticRateCapture(.5, { corruptIdentity: true })).status, "inconclusive");
  checks.push({ name: "ambiguous carrier remains inconclusive" });
  const invalid = createSyntheticRateCapture(1); delete invalid.pcm.normalCue;
  assert.throws(() => analyzeRateClickAudit(invalid)); checks.push({ name: "missing cue PCM rejected" });
  for (const rate of [1, .75, .5, .25]) {
    const clickOff = { start: .3 + 1.25 / rate, end: .3 + 2.25 / rate };
    const expectation = { kind: "click-toggle" as const,
      off: { beforeContextTime: clickOff.start, afterContextTime: clickOff.start },
      on: { beforeContextTime: clickOff.end, afterContextTime: clickOff.end } };
    const gated = analyzeRateClickAudit(createSyntheticRateCapture(rate, { clickOff }), expectation);
    assert.equal(gated.status, "passed", JSON.stringify(gated));
    assert.equal(gated.gating.maximumDisabledClick, 0);
    assert.equal(gated.gating.musicBeatsWhileClickOff, 2);
    assert.equal(gated.gatedBeats.length, 2);
    assert.equal(gated.pairs.length, 7);
    checks.push({ name: `${rate}x explicit click-off window preserves music identity and checks remaining audible timing` });
    const leaking = analyzeRateClickAudit(createSyntheticRateCapture(rate), expectation);
    assert.equal(leaking.status, "failed");
    assert(leaking.failures.some((failure) => failure.includes("expected disabled")));
    checks.push({ name: `${rate}x click continuing during expected off window fails` });
    const muted = analyzeRateClickAudit(createSyntheticRateCapture(rate, { musicMuted: true }), { kind: "all-music-muted" });
    assert.equal(muted.status, "passed", JSON.stringify(muted));
    assert.equal(muted.musicSynchronizationMeasured, false);
    assert.equal(muted.pairs.length, 0);
    assert.equal(muted.cueClickPairs.length, 9);
    checks.push({ name: `${rate}x all music muted requires silence and six or more real cue/click matches without claiming music sync` });
  }
  const unmuted = analyzeRateClickAudit(createSyntheticRateCapture(1), { kind: "all-music-muted" });
  assert(unmuted.failures.some((failure) => failure.includes("expected muted")));
  checks.push({ name: "audible music in expected all-muted capture remains a failure even with insufficient valid pairs" });
  const boundary = analyzeRateClickAudit(createSyntheticRateCapture(1, { startBeat: 10, missingFirst: true }));
  assert.equal(boundary.status, "failed");
  assert(boundary.failures.some((failure) => failure.includes("Fixture beat5 missing")));
  checks.push({ name: "marker5.0 boundary native omission fails rather than shifting ordinal identities" });
  const firstAfterSeekMissing = createSyntheticRateCapture(1, { startBeat: 11, missingFirst: true });
  firstAfterSeekMissing.clocks[0].mediaTime = 5.2;
  firstAfterSeekMissing.events[0].mediaTime = 5.2;
  const lost55 = analyzeRateClickAudit(firstAfterSeekMissing, { kind: "music-and-click" }, 5.2);
  assert.equal(lost55.status, "failed");
  assert(lost55.failures.some((failure) => failure.includes("beat5.5 missing")));
  checks.push({ name: "lost first expected5.5 beat after non-boundary seek5.2 fails" });
  const rounded = createSyntheticRateCapture(1, { startBeat: 10 });
  rounded.clocks[0].mediaTime = 5.000001;
  assert.equal(analyzeRateClickAudit(rounded, { kind: "music-and-click" }, 5).status, "passed");
  checks.push({ name: "microsecond media-clock rounding does not change explicit first expected beat5.0" });
  const wrongSeek = createSyntheticRateCapture(1, { startBeat: 10 });
  const wrongReport = analyzeRateClickAudit(wrongSeek, { kind: "music-and-click" }, 5.2);
  assert.equal(wrongReport.status, "failed");
  assert(wrongReport.failures.some((failure) => failure.includes("does not match requested")));
  checks.push({ name: "ready media at wrong seek target fails independently of audio identity" });
  const mutatePcm = (capture: ClickAuditCapture, channels: Array<keyof ClickAuditCapture["pcm"]>, change: (samples: Float32Array) => void) => {
    for (const channel of channels) {
      const bytes = Buffer.from(capture.pcm[channel]!, "base64");
      const samples = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      change(samples);
      capture.pcm[channel] = Buffer.from(samples.buffer).toString("base64");
    }
  };
  for (const rate of [1, .75, .5, .25]) for (const shiftMs of [-24, 24]) {
    const displacedCueAndClick = createSyntheticRateCapture(rate);
    mutatePcm(displacedCueAndClick, ["normalCue", "downbeatCue", "clickLeft", "clickRight"], (samples) => {
      const copy = samples.slice(), offset = Math.round(shiftMs / 1000 * displacedCueAndClick.sampleRate);
      samples.fill(0);
      if (offset > 0) samples.set(copy.subarray(0, copy.length - offset), offset);
      else samples.set(copy.subarray(-offset));
    });
    const result = analyzeRateClickAudit(displacedCueAndClick, { kind: "music-and-click" }, 0);
    assert.equal(result.status, "failed");
    assert(result.failures.some((failure) => failure.includes("±20ms")));
    assert(result.pairs.every((pair) => Math.abs(pair.cueMinusNativeOriginMs - shiftMs) < 1));
    checks.push({ name: `${rate}x cue and click shifted together${shiftMs}ms fails physical music alignment` });
  }
  for (const removeCue of [false, true]) {
    const early = createSyntheticRateCapture(1, { prefixSeconds: .01 });
    mutatePcm(early, ["musicLeft", "musicRight", "clickLeft", "clickRight", ...(removeCue ? ["normalCue", "downbeatCue"] as const : [])],
      (samples) => samples.fill(0, 0, Math.round(.4 * early.sampleRate)));
    const result = analyzeRateClickAudit(early, { kind: "music-and-click" }, 0);
    assert.equal(result.status, "failed");
    assert(result.failures.some((failure) => failure.includes("Native beat 0s has 0 music")));
    checks.push({ name: `first native pulse at10ms requires music/click${removeCue ? "/cue" : ""} partners despite analysis lookback reaching start` });
  }
  const earlyOrphan = createSyntheticRateCapture(1);
  mutatePcm(earlyOrphan, ["clickLeft", "clickRight"], (samples) => samples.fill(.01, 480, 528));
  const orphanReport = analyzeRateClickAudit(earlyOrphan, { kind: "music-and-click" }, 0);
  assert.equal(orphanReport.status, "failed");
  assert.equal(orphanReport.orphanClicks.length, 1);
  checks.push({ name: "stale orphan click at10ms after arm-before-Play fails" });
  for (const channel of ["musicRight", "clickRight"] as const) {
    const missingRight = createSyntheticRateCapture(.5);
    mutatePcm(missingRight, [channel], (samples) => samples.fill(0));
    const result = analyzeRateClickAudit(missingRight, { kind: "music-and-click" }, 0);
    assert.equal(result.status, "failed");
    assert(result.failures.some((failure) => failure.includes("Duplicated-stereo")));
    checks.push({ name: `missing ${channel} cannot pass left-only timing` });
  }
  const shiftedRight = createSyntheticRateCapture(.5);
  mutatePcm(shiftedRight, ["clickRight"], (samples) => { const old = samples.slice(); samples.fill(0); samples.set(old.subarray(0, old.length - 1152), 1152); });
  assert.equal(analyzeRateClickAudit(shiftedRight, { kind: "music-and-click" }, 0).status, "failed");
  checks.push({ name: "right-only click delay24ms fails duplicated-stereo parity" });
  const numericalMusicDifference = createSyntheticRateCapture(.25);
  mutatePcm(numericalMusicDifference, ["musicRight"], (samples) => {
    for (let frame = 0; frame < samples.length; frame++) if (samples[frame] !== 0) samples[frame] += Math.sin(2 * Math.PI * 7777 * frame / 48000) / 32768;
  });
  assert.equal(analyzeRateClickAudit(numericalMusicDifference, { kind: "music-and-click" }, 0).status, "passed");
  checks.push({ name: "bounded one-PCM16-LSB numerical music difference passes coherence/level/centroid checks, without requiring bit identity" });
  const attenuatedRight = createSyntheticRateCapture(.5);
  mutatePcm(attenuatedRight, ["musicRight"], (samples) => { for (let frame = 0; frame < samples.length; frame++) samples[frame] *= .995; });
  assert.equal(analyzeRateClickAudit(attenuatedRight, { kind: "music-and-click" }, 0).status, "failed");
  checks.push({ name: "right-only music0.5% attenuation fails0.1% level agreement" });
  const invertedRight = createSyntheticRateCapture(.5);
  mutatePcm(invertedRight, ["musicRight"], (samples) => { for (let frame = 0; frame < samples.length; frame++) samples[frame] *= -1; });
  assert.equal(analyzeRateClickAudit(invertedRight, { kind: "music-and-click" }, 0).status, "failed");
  checks.push({ name: "right-only music phase inversion fails zero-lag coherence" });
  const delayedMusicRight = createSyntheticRateCapture(.5);
  mutatePcm(delayedMusicRight, ["musicRight"], (samples) => { const old = samples.slice(); samples.fill(0); samples.set(old.subarray(0, old.length - 1152), 1152); });
  const delayedMusicReport = analyzeRateClickAudit(delayedMusicRight, { kind: "music-and-click" }, 0);
  assert.equal(delayedMusicReport.status, "failed");
  assert(delayedMusicReport.failures.some((failure) => failure.includes("right music centroid")));
  checks.push({ name: "right-only music24ms delay fails both stereo and physical right-music timing" });
  const tail = createSyntheticRateCapture(1, { musicMuted: true });
  tail.frames = Math.round(4.4 * tail.sampleRate);
  for (const channel of Object.keys(tail.pcm) as Array<keyof ClickAuditCapture["pcm"]>) {
    tail.pcm[channel] = Buffer.from(tail.pcm[channel]!, "base64").subarray(0, tail.frames * 4).toString("base64");
  }
  const tailReport = analyzeRateClickAudit(tail, { kind: "all-music-muted" }, 0);
  assert.equal(tailReport.status, "passed");
  assert.equal(tailReport.trailingPairs.length, 1);
  assert.equal(tailReport.cueClickPairs.length, 8);
  checks.push({ name: "all-muted native cue due after capture end is explicitly incomplete rather than missing click" });
  const lateArm = createSyntheticRateCapture(.5); lateArm.events[0].contextTime = -.01;
  assert.equal(analyzeRateClickAudit(lateArm, { kind: "music-and-click" }, 0).status, "inconclusive");
  checks.push({ name: "rate capture with native play before recorder start cannot establish initial source completeness" });
  const desktopNames = Array.from({ length: 4 }, (_, index) => `desktop-${index}`);
  const rateNames = Array.from({ length: 48 }, (_, index) => `rates-${index}`);
  const plans = [{ expected: 4, names: desktopNames }, { expected: 48, names: rateNames }];
  assert.equal(assessClickAuditCoverage(plans, [...desktopNames, ...rateNames]).expected, 52);
  checks.push({ name: "combined desktop4 and rate48 plans retain52 distinct expected scenarios" });
  const missingWithExtra = assessClickAuditCoverage(plans, [...desktopNames, ...rateNames.slice(1), "unrelated-extra"]);
  assert.deepEqual(missingWithExtra.missingNames, ["rates-0"]);
  assert.equal(missingWithExtra.missing, 1);
  checks.push({ name: "unrelated extra raw recording cannot fill a missing named planned scenario" });
  assert.equal(assessClickAuditCoverage([{ expected: 4, names: ["a", "b"] }], ["a", "b", "extra1", "extra2"]).missing, 2);
  checks.push({ name: "historical unspecified expected scenarios remain missing despite extra raw files" });
  const nativeNames = Array.from({ length: 8 }, (_, index) => `native-${index}`);
  const incompleteNative = summarizeClickAuditCoverage({ missingDesktop: 0, expectedNativeNames: nativeNames,
    recordedNames: nativeNames.slice(0, 5), expectedTotal: 64, recordedTotal: 61 });
  assert.deepEqual({ desktop: incompleteNative.missingDesktop, native: incompleteNative.missingNative,
    total: incompleteNative.missing, unnamed: incompleteNative.unnamedMissing }, { desktop: 0, native: 3, total: 3, unnamed: 0 });
  checks.push({ name: "native3 missing and desktop0 missing report total3 without count-deficit duplication" });
  const duplicateNative = summarizeClickAuditCoverage({ missingDesktop: 0, expectedNativeNames: ["native-a", "native-a"],
    recordedNames: [], expectedTotal: 1, recordedTotal: 0 });
  assert.equal(duplicateNative.missing, 1); assert.deepEqual(duplicateNative.missingNativeNames, ["native-a"]);
  checks.push({ name: "duplicate expected native names are deduplicated for missing coverage" });
  const countOnlyDeficit = summarizeClickAuditCoverage({ missingDesktop: 1, expectedNativeNames: nativeNames,
    recordedNames: nativeNames.slice(0, 5), expectedTotal: 64, recordedTotal: 59 });
  assert.equal(countOnlyDeficit.missing, 4); assert.equal(countOnlyDeficit.unnamedMissing, 1);
  checks.push({ name: "unnamed count shortage excludes already counted desktop and native missing cases" });
  const substitutedNative = summarizeClickAuditCoverage({ missingDesktop: 0, expectedNativeNames: nativeNames,
    recordedNames: [...nativeNames.slice(0, 5), "extra-a", "extra-b", "extra-c"], expectedTotal: 64, recordedTotal: 64 });
  assert.equal(substitutedNative.missing, 3); assert.equal(substitutedNative.unnamedMissing, 0);
  checks.push({ name: "matching total count cannot replace three missing named native recordings" });
  return { passed: true, count: checks.length, checks,
    limits: "Synthetic signal calibration validates the estimator, not the actual native resampler or Signalsmith envelope preservation. Real PCM must meet both envelope estimators and carrier confidence; disagreement remains inconclusive." };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) console.log(JSON.stringify(runClickRateCalibration(), null, 2));
