import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { analyzeIdentifiedClicks } from "./clickAuditIdentity";
import { detectClickAuditPulses } from "./clickAuditAnalysis";
import { createClickAuditWav } from "./clickAuditFixtures";
import { analyzeClickClockMapping } from "./clickAuditClockMap";
import { ClickCueDsp } from "../src/lib/clickCueDsp";
import type { ClickAuditCapture } from "./clickAuditSignal";

function clickProfile(rate: number, downbeat: boolean) {
  const duration = downbeat ? .075 : .045;
  const maximum = downbeat ? .14 : .075;
  return Float32Array.from({ length: Math.ceil((duration + .01) * rate) }, (_, frame) => {
    const time = frame / rate;
    const amplitude = time <= .002 ? .0001 * (maximum / .0001) ** (time / .002)
      : time <= duration ? maximum * (.0001 / maximum) ** ((time - .002) / (duration - .002)) : .0001;
    return amplitude * Math.sign(Math.sin(2 * Math.PI * (downbeat ? 1760 : 1120) * time));
  });
}

export function runClickAuditCalibration() {
  const checks: { name: string; observedMs?: number }[] = [];
  for (const rate of [48_000, 44_100]) {
    const cueFrame = Math.round(.05 * rate);
    const renderEnableWindow = (enabled: (frame: number) => boolean) => {
      const dsp = new ClickCueDsp(rate, .12);
      return Float32Array.from({ length: Math.round(.4 * rate) }, (_, frame) =>
        dsp.processSample(frame >= cueFrame && frame < cueFrame + Math.round(.001 * rate) ? 1 : 0, 0, enabled(frame)));
    };
    const alwaysEnabled = renderEnableWindow(() => true);
    const enabledBeforeDue = renderEnableWindow((frame) => frame >= Math.round(.1 * rate));
    assert.deepEqual(enabledBeforeDue, alwaysEnabled);
    checks.push({ name: `input cue retained when enabled before audible beat ${rate}Hz` });
    const disabledAcrossDue = renderEnableWindow((frame) => frame < Math.round(.15 * rate) || frame >= Math.round(.2 * rate));
    assert(disabledAcrossDue.every((sample) => sample === 0));
    checks.push({ name: `disabled audible beat never replays on late enable ${rate}Hz` });
    const music = Float32Array.from({ length: Math.round(.02 * rate) }, (_, frame) =>
      .08 * (1 - Math.cos(2 * Math.PI * frame / (Math.round(.02 * rate) - 1))) / 2 * Math.sin(2 * Math.PI * 600 * frame / rate));
    for (const downbeat of [true, false]) {
      const click = clickProfile(rate, downbeat);
      const musicOnset = detectClickAuditPulses(music, rate)[0];
      const clickOnset = detectClickAuditPulses(click, rate)[0];
      const biasMs = (clickOnset - musicOnset) / rate * 1000;
      assert(Math.abs(biasMs) < 2, "Pulse profile threshold bias must remain below 2 ms.");
      checks.push({ name: `aligned Hann/exponential ${rate}Hz ${downbeat ? "downbeat" : "beat"}`, observedMs: biasMs });
      const dsp = new ClickCueDsp(rate, .12);
      const rendered = Float32Array.from({ length: Math.ceil(.25 * rate) }, (_, frame) =>
        dsp.processSample(frame < Math.ceil(.001 * rate) && !downbeat ? 1 : 0,
          frame < Math.ceil(.001 * rate) && downbeat ? 1 : 0, true));
      const workletBiasMs = (detectClickAuditPulses(rendered, rate)[0] - Math.round(.12 * rate) - musicOnset) / rate * 1000;
      assert(Math.abs(workletBiasMs) < 2);
      checks.push({ name: `production cue DSP/Hann onset ${rate}Hz ${downbeat}`, observedMs: workletBiasMs });
      for (const offsetMs of [-25, 25]) {
        const shift = Math.round(offsetMs * rate / 1000);
        const source = new Float32Array(rate);
        const shifted = new Float32Array(rate);
        source.set(music, Math.round(rate / 4));
        shifted.set(click, Math.round(rate / 4) + shift);
        const measured = (detectClickAuditPulses(shifted, rate)[0] - detectClickAuditPulses(source, rate)[0]) / rate * 1000;
        assert(Math.abs(measured - biasMs - offsetMs) <= 1000 / rate);
        checks.push({ name: `known ${offsetMs}ms profile offset ${rate}Hz ${downbeat}`, observedMs: measured });
      }
    }
  }
  const fixture = createClickAuditWav();
  const fs = 48_000;
  const frames = 5 * fs;
  const prefix = 9600;
  const latency = 5760;
  const native = new Float32Array(frames);
  const music = new Float32Array(frames);
  const clicks = new Float32Array(frames);
  for (let frame = 0; frame + prefix + latency < frames; frame++) {
    const value = fixture.readInt16LE(44 + frame * 4) / 32768;
    native[frame + prefix] = value;
    music[frame + prefix + latency] = value;
  }
  for (let index = 0; index < 10; index++) {
    const start = index * fs / 2 + prefix + latency;
    const pulse = clickProfile(fs, index % 4 === 0);
    if (start + pulse.length <= frames) clicks.set(pulse, start);
  }
  const encode = (samples: Float32Array) => Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength).toString("base64");
  const capture = (n = native, m = music, c = clicks): ClickAuditCapture => ({
    protocol: "mimicopy-click-pcm-v1", frames, sampleRate: fs, startContextTime: 0, encoding: "float32-le-base64",
    pcm: { nativeLeft: encode(n), nativeRight: encode(n), musicLeft: encode(m), musicRight: encode(m), clickLeft: encode(c), clickRight: encode(c) },
    clocks: [{ performanceTime: 0, contextTime: 0, state: "running", sampleRate: fs, baseLatency: 0, outputLatency: 0, outputTimestamp: null, mediaTime: 0, rate: 1, paused: true, readyState: 4 }],
    events: [{ event: "play", performanceTime: 5, contextTime: .005, state: "running", sampleRate: fs,
      baseLatency: 0, outputLatency: 0, outputTimestamp: null, mediaTime: 0, rate: 1, paused: false, readyState: 4 }],
    routing: { musicDestinationNodes: 1, clickDestinationNodes: 10, sourceElements: 1 }
  });
  assert.equal(analyzeIdentifiedClicks(capture(), fixture).status, "passed"); checks.push({ name: "identity-aligned full capture" });
  const longCapture = capture();
  longCapture.frames = 35 * fs;
  for (const key of ["nativeLeft", "nativeRight", "musicLeft", "musicRight", "clickLeft", "clickRight"] as const) {
    const source = key.startsWith("native") ? native : key.startsWith("music") ? music : clicks;
    const padded = new Float32Array(longCapture.frames); padded.set(source);
    longCapture.pcm[key] = encode(padded);
  }
  assert.equal(analyzeIdentifiedClicks(longCapture, fixture).status, "passed");
  checks.push({ name: "35-second valid PCM with silence padding preserves identity verdict without regex stack overflow" });
  const longNative = longCapture.pcm.nativeLeft;
  longCapture.pcm.nativeLeft = longNative.slice(0, -1) + "!";
  assert.throws(() => analyzeIdentifiedClicks(longCapture, fixture), /Invalid PCM base64/);
  checks.push({ name: "35-second PCM still rejects an invalid base64 alphabet at the end" });
  longCapture.pcm.nativeLeft = "=" + longNative.slice(1);
  assert.throws(() => analyzeIdentifiedClicks(longCapture, fixture), /Invalid PCM base64/);
  checks.push({ name: "35-second PCM still rejects misplaced base64 padding" });
  const cueDsp = new ClickCueDsp(fs, latency / fs);
  const cueClicks = Float32Array.from({ length: frames }, (_, frame) => {
    const relative = frame - prefix;
    const beat = Math.floor(relative / (fs / 2));
    const active = relative >= 0 && relative % (fs / 2) < 48;
    return cueDsp.processSample(active && beat % 4 !== 0 ? 1 : 0, active && beat % 4 === 0 ? 1 : 0, true);
  });
  assert.equal(analyzeIdentifiedClicks(capture(native, music, cueClicks), fixture).status, "passed");
  checks.push({ name: "production cue DSP complete 1x identity capture" });
  const earlyOrphan = clicks.slice(); earlyOrphan.fill(.01, 480, 528);
  const earlyOrphanReport = analyzeIdentifiedClicks(capture(native, music, earlyOrphan), fixture, 0);
  assert.equal(earlyOrphanReport.status, "failed");
  assert.equal(earlyOrphanReport.orphanClicks.length, 1);
  checks.push({ name: "1x stale click at10ms is not waived by capture-start exclusion" });
  const missingClickRight = capture(); missingClickRight.pcm.clickRight = encode(new Float32Array(frames));
  assert.equal(analyzeIdentifiedClicks(missingClickRight, fixture, 0).status, "failed");
  checks.push({ name: "1x missing right click cannot pass left-only identity timing" });
  const beganLate = capture(); beganLate.events[0].contextTime = -.01;
  assert.equal(analyzeIdentifiedClicks(beganLate, fixture, 0).status, "inconclusive");
  checks.push({ name: "native play event before recorder start makes initial coverage inconclusive" });
  const missingClick = clicks.slice(); missingClick.fill(0, 0, prefix + latency + 5000);
  assert.equal(analyzeIdentifiedClicks(capture(native, music, missingClick), fixture).status, "failed"); checks.push({ name: "missing first click fails" });
  const missingSource = native.slice(); missingSource.fill(0, prefix, prefix + 960);
  assert.equal(analyzeIdentifiedClicks(capture(missingSource), fixture).status, "failed"); checks.push({ name: "missing identified source beat0 fails" });
  const interiorSource = native.slice(); interiorSource.fill(0, prefix + fs, prefix + fs + 960);
  assert(analyzeIdentifiedClicks(capture(interiorSource), fixture).failures.some((failure) => failure.includes("skips or repeats")));
  checks.push({ name: "missing interior native identity fails" });
  const missingMusic = music.slice(); missingMusic.fill(0, prefix + latency, prefix + latency + 960);
  assert.equal(analyzeIdentifiedClicks(capture(native, missingMusic), fixture).status, "failed"); checks.push({ name: "missing processed music/orphan click fails" });
  const lateClicks = new Float32Array(frames); lateClicks.set(clicks.subarray(0, frames - 1200), 1200);
  assert.equal(analyzeIdentifiedClicks(capture(native, music, lateClicks), fixture).status, "failed"); checks.push({ name: "25ms late clicks fail unchanged20ms threshold" });
  const wrongIdentity = native.slice(); wrongIdentity.fill(.01, prefix + 24_000, prefix + 24_960);
  assert.equal(analyzeIdentifiedClicks(capture(wrongIdentity), fixture).unresolved, true); checks.push({ name: "corrupt pulse identity remains unresolved" });
  const invalid = capture(); invalid.pcm.nativeLeft = invalid.pcm.nativeLeft.slice(0, -4);
  assert.throws(() => analyzeIdentifiedClicks(invalid, fixture)); checks.push({ name: "truncated PCM rejected" });
  const nonfinite = native.slice(); nonfinite[50] = NaN;
  assert.throws(() => analyzeIdentifiedClicks(capture(nonfinite), fixture)); checks.push({ name: "nonfinite PCM rejected" });
  const empty = capture(); empty.frames = 0;
  assert.throws(() => analyzeIdentifiedClicks(empty, fixture)); checks.push({ name: "empty capture rejected" });
  const slowed = capture(); slowed.clocks[0].rate = .5;
  assert.throws(() => analyzeIdentifiedClicks(slowed, fixture), /only constant 1x/);
  checks.push({ name: "unsupported rate explicitly rejected" });
  const rightInvalid = capture(); rightInvalid.pcm.clickRight = "broken";
  assert.throws(() => analyzeIdentifiedClicks(rightInvalid, fixture)); checks.push({ name: "invalid right PCM rejected" });
  for (const delayMs of [0, 30, 65]) {
    const clocksCapture = capture();
    clocksCapture.clocks = Array.from({ length: 12 }, (_, index) => ({ ...clocksCapture.clocks[0],
      contextTime: 1.88 + index * .02, mediaTime: 1.88 + index * .02 - delayMs / 1000, paused: false }));
    const report = analyzeClickClockMapping(clocksCapture, { pairs: [
      { beatTime: 2, nativeContextTime: 2, musicMinusNativeMs: 120, clickMinusMusicMs: delayMs }
    ] });
    assert(Math.abs((report.steadyPredictedSourceMinusActualMs?.median ?? NaN) - delayMs) < 1e-8);
    checks.push({ name: `known native/media clock mapping ${delayMs}ms` });
  }
  return { passed: true, count: checks.length, checks,
    limits: "Synthetic detector/identity calibration only. Browser oscillator anti-aliasing and actual audio routing still require real PCM recordings." };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(JSON.stringify(runClickAuditCalibration(), null, 2));
}
