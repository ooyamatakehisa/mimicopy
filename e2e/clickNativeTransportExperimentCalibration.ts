import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

// Pure PCM fixtures exercise the analyzer without launching a browser or playing
// audio. Known missing/stale blocks must fail even when later PCM fits perfectly.
const sampleRate = 48_000, frames = 4 * sampleRate;
const cueTimes = [0, .005, .05, .1, .25, .5, .75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4, 5];
const frequencies = [375, 562.5, 750, 937.5, 1125, 1500];
const fixture = Buffer.alloc(68 + 6 * sampleRate * 8 * 2);
fixture.write("RIFF", 0); fixture.writeUInt32LE(fixture.length - 8, 4); fixture.write("WAVEfmt ", 8);
fixture.writeUInt32LE(40, 16); fixture.writeUInt16LE(0xfffe, 20); fixture.writeUInt16LE(8, 22);
fixture.writeUInt32LE(sampleRate, 24); fixture.writeUInt32LE(sampleRate * 16, 28);
fixture.writeUInt16LE(16, 32); fixture.writeUInt16LE(16, 34); fixture.writeUInt16LE(22, 36);
fixture.writeUInt16LE(16, 38); fixture.writeUInt32LE(0x63f, 40);
Buffer.from("0100000000001000800000aa00389b71", "hex").copy(fixture, 44);
fixture.write("data", 60); fixture.writeUInt32LE(fixture.length - 68, 64);
for (let frame = 0; frame < 6 * sampleRate; frame++) {
  const time = frame / sampleRate;
  const envelope = .45 + .25 * Math.sin(2 * Math.PI * .713 * time + .2) + .15 * Math.sin(2 * Math.PI * 1.123 * time + .6);
  for (let channel = 0; channel < 6; channel++) fixture.writeInt16LE(Math.round(32767 * .03 * envelope * Math.sin(2 * Math.PI * frequencies[channel] * time)), 68 + (frame * 8 + channel) * 2);
}
for (const [index, time] of cueTimes.entries()) {
  for (let frame = Math.round(time * sampleRate); frame < Math.round(time * sampleRate) + 48; frame++) {
    fixture.writeInt16LE(2048 + index * 128, 68 + (frame * 8 + (index % 2 === 0 ? 7 : 6)) * 2);
  }
}
const root = path.resolve("audio-audit.local");
await mkdir(root, { recursive: true });
const output = await mkdtemp(path.join(root, "click-native-start-order-calibration-"));
await writeFile(path.join(output, "fixture.wav"), fixture);
await writeFile(path.join(output, "metadata.json"), JSON.stringify({ cueTimes, cueChannels: cueTimes.map((_, index) => index % 2 === 0 ? 7 : 6) }));
const cases = [
  { name: "epsilon-immediate", target: 1 / sampleRate, order: "immediate", start: 1, lead: 0, stale: 0, validControl: true, preserved: true },
  { name: "epsilon-wait-seeked", target: 1 / sampleRate, order: "wait-seeked", start: 1, lead: 0, stale: 0, validControl: true, preserved: true },
  { name: "target1-immediate", target: 1, order: "immediate", start: sampleRate, lead: 0, stale: 0, validControl: true, preserved: true },
  { name: "dropped-first-block", target: 1 / sampleRate, order: "immediate", start: 4097, lead: 0, stale: 0, validControl: true, preserved: false },
  { name: "old-pcm-before-target", target: 1, order: "immediate", start: sampleRate, lead: 0, stale: 768, validControl: true, preserved: false },
  { name: "silent-native-latency", target: 1 / sampleRate, order: "immediate", start: 1, lead: 192, stale: 0, validControl: true, preserved: true },
  { name: "wrong-control-order", target: 1 / sampleRate, order: "wait-seeked", start: 1, lead: 0, stale: 0, validControl: false, preserved: true }
] as const;
for (const test of cases) {
  const streams = Array.from({ length: 8 }, (_, channel) => {
    const samples = new Float32Array(frames);
    for (let frame = test.lead; frame < frames; frame++) {
      const fixtureFrame = frame < test.stale ? frame : test.start + frame - test.lead - test.stale;
      samples[frame] = fixture.readInt16LE(68 + (fixtureFrame * 8 + channel) * 2) / 32768;
    }
    return Buffer.from(samples.buffer).toString("base64");
  });
  const actions = test.order === "immediate" ? [
    { event: "trusted-replay", performanceTime: 10, trusted: true },
    { event: "seek-assigned", performanceTime: 11 }, { event: "capture-play-call", performanceTime: 12 }
  ] : [
    { event: "seek-assigned", performanceTime: 1 },
    { event: "seeked-observed", performanceTime: test.validControl ? 2 : 11 },
    { event: "trusted-replay", performanceTime: 10, trusted: true }, { event: "capture-play-call", performanceTime: 12 }
  ];
  await writeFile(path.join(output, `${test.name}.json`), JSON.stringify({ codec: "flac", sampleRate, frames, startFrame: 0,
    streams, inputChannelCounts: [8], target: test.target, order: test.order, scenario: "fresh", padded: false,
    actions: actions.map((action) => ({ ...action, contextTime: 0, mediaTime: test.target })) }));
}
try {
  await promisify(execFile)(process.execPath, ["--import", "tsx", "e2e/clickNativeTransportExperimentCheck.ts", ...cases.map(({ name }) => name)], {
    cwd: process.cwd(), env: { ...process.env, MIMICOPY_NATIVE_TRANSPORT_OUTPUT: output }, maxBuffer: 4 * 1024 * 1024
  });
  assert.fail("Injected boundary and control failures must give a nonzero analyzer exit.");
} catch (error) {
  assert.ok(error instanceof Error && "code" in error && error.code === 1, "Analyzer should detect faults, not become inconclusive.");
}
for (const test of cases) {
  const result = JSON.parse(await readFile(path.join(output, `${test.name}-analysis.json`), "utf8")) as {
    startupPreserved: boolean; verifiedControlOrder: boolean; codecPreservesEightChannels: boolean; steadyMismatchedFrames: number;
    earlyPcm: { firstActualFixtureFrame: number | null; startedBeforeTarget: boolean | null; sameOffsetAsSteady: boolean | null };
    cues: Array<{ cueIndex: number; widthFrames: number; errorFrames: number }>;
  };
  assert.equal(result.startupPreserved, test.preserved, `${test.name}: boundary preservation`);
  assert.equal(result.verifiedControlOrder, test.validControl, `${test.name}: trusted control order`);
  assert.equal(result.earlyPcm.firstActualFixtureFrame, test.stale ? 0 : test.start, `${test.name}: independent first source frame`);
  if (test.preserved) {
    assert.equal(result.codecPreservesEightChannels, true, `${test.name}: exact music/cue identity`);
    assert.equal(result.steadyMismatchedFrames, 0, `${test.name}: steady sample continuity`);
    if (test.target < 1) {
      const boundaryCue = result.cues.find(({ cueIndex }) => cueIndex === 0);
      assert.ok(boundaryCue, `${test.name}: boundary cue remains present`);
      assert.equal(boundaryCue.widthFrames, 47, `${test.name}: exactly clipped epsilon pulse`);
      assert.equal(boundaryCue.errorFrames, 0, `${test.name}: exact cue phase`);
    }
  }
  if (test.stale) {
    assert.equal(result.earlyPcm.startedBeforeTarget, true);
    assert.equal(result.earlyPcm.sameOffsetAsSteady, false);
    assert.ok(result.steadyMismatchedFrames > 0);
  }
}
console.log(JSON.stringify({ passed: cases.length, scope: "Synthetic PCM only; no browser or audio capture.", output }));
