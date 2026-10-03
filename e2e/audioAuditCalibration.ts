import assert from "node:assert/strict";
import { resolveObjectURL } from "node:buffer";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { audioAuditEnvelope, audioAuditFrequencies, audioAuditRightFrequencies, createAudioAuditWav } from "./audioAuditFixtures";
import {
  installAudioAuditProbe,
  type AudioAuditChannel,
  type AudioAuditProbe,
  type AudioMeasurement
} from "./audioAuditSignal";

/**
 * Run with pnpm exec tsx e2e/audioAuditCalibration.ts.
 * This calibrates the real probe's worklet and estimator with known PCM inputs.
 * The synthetic graph below is exclusively a measurement-algorithm test. It is
 * not browser evidence and does not participate in the application audit.
 */
type CaptureRequest = { id: number; frames: number } | { cancel: true };
type ProcessorMessage = {
  id: number;
  frames: number;
  blockSize: number;
  energies: Float32Array;
  mixed: Float32Array;
  left: Float32Array;
  right: Float32Array;
  sources: Float32Array[];
};
type ProcessorPort = {
  onmessage: ((event: { data: CaptureRequest }) => void) | null;
  postMessage(data: ProcessorMessage): void;
};
type Processor = {
  port: ProcessorPort;
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};
type ProcessorConstructor = new () => Processor;
type Settings = {
  delaysMs: number[];
  audible: boolean[];
  sampleRate: number;
  transposeSemitones?: number;
  stereo?: boolean;
  /** Realistic source varispeed; the synthetic final mix restores pitch. */
  varispeedRate?: number;
  carrierPhases?: number[];
  unrelatedEnvelopes?: boolean;
  fault?: StereoFault;
};
type StereoFault = {
  kind: "crossfeed" | "impulse" | "dropout" | "gain-step" | "phase-jump";
  startMs: number;
  durationMs: number;
  amount: number;
  direction?: "right-to-left" | "left-to-right";
};
type CalibrationCase = {
  sampleRate: number;
  delaysMs?: number[];
  expectedLags?: number[];
  audible?: boolean[];
  result: AudioMeasurement;
};

const fixtures = [0, 1, 2].map((index) => createAudioAuditWav(index, 5));
const channels: AudioAuditChannel[] = ["original", "stem", "remainder"];
let settings: Settings = {
  delaysMs: [0, 0, 0],
  audible: [true, true, true],
  sampleRate: 48_000
};
let processorConstructor: ProcessorConstructor | null = null;

class SyntheticNode {
  readonly connections: SyntheticNode[] = [];
  constructor(readonly context: SyntheticContext) {}

  connect(destination: SyntheticNode): SyntheticNode {
    this.connections.push(destination);
    return destination;
  }

  disconnect(destination?: SyntheticNode): void {
    if (!destination) this.connections.length = 0;
    else this.connections.splice(this.connections.indexOf(destination), 1);
  }
}

class SyntheticGain extends SyntheticNode {}
class SyntheticSplitter extends SyntheticNode { readonly numberOfOutputs = 6; }

class SyntheticProcessorBase {
  port: ProcessorPort = {
    onmessage: null,
    postMessage: () => { throw new Error("Worklet receiver has not been connected."); }
  };
}

class SyntheticContext {
  readonly sampleRate = settings.sampleRate;
  state: AudioContextState = "running";
  readonly destination = new SyntheticNode(this);
  readonly audioWorklet = {
    addModule: async (url: string) => {
      const blob = resolveObjectURL(url);
      assert.ok(blob, "Probe worklet Blob URL must resolve.");
      const code = await blob.text();
      runInNewContext(code, {
        AudioWorkletProcessor: SyntheticProcessorBase,
        registerProcessor: (_name: string, implementation: ProcessorConstructor) => {
          processorConstructor = implementation;
        }
      });
    }
  };

  createMediaElementSource(_element: { getAttribute(name: string): string }): SyntheticNode {
    return new SyntheticNode(this);
  }

  resume(): void {}
}

class SyntheticWorklet extends SyntheticNode {
  readonly processor: Processor;
  readonly port: {
    onmessage: ((event: { data: ProcessorMessage }) => void) | null;
    postMessage(request: CaptureRequest): void;
  };

  constructor(context: SyntheticContext) {
    super(context);
    assert.ok(processorConstructor, "Probe must register its actual worklet implementation.");
    this.processor = new processorConstructor();
    this.port = {
      onmessage: null,
      postMessage: (request) => {
        assert.ok(this.processor.port.onmessage);
        this.processor.port.onmessage({ data: request });
        if ("cancel" in request) return;
        queueMicrotask(() => {
          const frames = Math.ceil(request.frames / 128) * 128;
          const varispeedSample = (channel: number, frame: number, right: boolean, final: boolean) => {
            if (!settings.audible[channel]) return 0;
            const outputTime = frame / context.sampleRate - settings.delaysMs[channel] / 1000;
            const mediaTime = 1 + (settings.varispeedRate ?? 1) * outputTime;
            const envelopeTime = mediaTime + (settings.unrelatedEnvelopes ? [0, 123.123, 287.875][channel] : 0);
            const frequency = (right ? audioAuditRightFrequencies : audioAuditFrequencies)[channel];
            const phase = settings.carrierPhases?.[channel + (right ? 3 : 0)] ?? 0;
            const carrierTime = final ? outputTime * 2 ** ((settings.transposeSemitones ?? 0) / 12) : mediaTime;
            return 0.025 * audioAuditEnvelope(envelopeTime) * Math.sin(2 * Math.PI * frequency * carrierTime + phase);
          };
          for (let frame = 0; frame < frames; frame += 128) {
            const sources = [0, 1, 2].map((channel) => Float32Array.from(
              { length: 128 },
              (_, index) => {
                if (!settings.audible[channel]) return 0;
                if (settings.varispeedRate !== undefined) return varispeedSample(channel, frame + index, false, false);
                const fixtureFrame = Math.round(
                  (1 + (frame + index) / context.sampleRate - settings.delaysMs[channel] / 1000) * 48_000
                );
                return fixtures[channel].readInt16LE(44 + 2 * fixtureFrame) / 32_768;
              }
            ));
            const mixed = Float32Array.from({ length: 128 }, (_, index) => {
              if (settings.varispeedRate !== undefined) {
                return [0, 1, 2].reduce((sum, channel) => sum + varispeedSample(channel, frame + index, false, true), 0);
              }
              if (!settings.transposeSemitones) return sources.reduce((sum, source) => sum + source[index], 0);
              const seconds = 1 + (frame + index) / context.sampleRate;
              return audioAuditFrequencies.reduce((sum, frequency, channel) => sum + (settings.audible[channel]
                ? 0.025 * audioAuditEnvelope(seconds) * Math.sin(2 * Math.PI * frequency * 2 ** (settings.transposeSemitones! / 12) * seconds)
                : 0), 0);
            });
            const rightSources = sources.map((_, channel) => Float32Array.from({ length: 128 }, (_, index) => {
              if (settings.varispeedRate !== undefined) return varispeedSample(channel, frame + index, true, false);
              const seconds = 1 + (frame + index) / context.sampleRate - settings.delaysMs[channel] / 1000;
              return settings.audible[channel] ? 0.025 * audioAuditEnvelope(seconds) *
                Math.sin(2 * Math.PI * audioAuditRightFrequencies[channel] * seconds) : 0;
            }));
            const mixedRight = Float32Array.from({ length: 128 }, (_, index) => {
              if (settings.varispeedRate !== undefined) {
                return [0, 1, 2].reduce((sum, channel) => sum + varispeedSample(channel, frame + index, true, true), 0);
              }
              const seconds = 1 + (frame + index) / context.sampleRate;
              return audioAuditRightFrequencies.reduce((sum, frequency, channel) => sum + (settings.audible[channel]
                ? 0.025 * audioAuditEnvelope(seconds) * Math.sin(2 * Math.PI * frequency * 2 ** ((settings.transposeSemitones ?? 0) / 12) * seconds)
                : 0), 0);
            });
            const fault = settings.fault;
            if (fault) for (let index = 0; index < 128; index++) {
              const timeMs = (frame + index) / context.sampleRate * 1000;
              if (timeMs < fault.startMs || timeMs >= fault.startMs + fault.durationMs) continue;
              if (fault.kind === "crossfeed") {
                if (fault.direction === "left-to-right") mixedRight[index] += fault.amount * mixed[index];
                else mixed[index] += fault.amount * mixedRight[index];
              } else if (fault.kind === "impulse") {
                // Independent additive broadband events, without any crosswire.
                mixed[index] += fault.amount;
                mixedRight[index] -= fault.amount * 0.7;
              } else {
                const gain = fault.kind === "dropout" ? 0 : fault.kind === "phase-jump" ? -1 : fault.amount;
                mixed[index] *= gain;
                mixedRight[index] *= gain;
                for (const source of [...sources, ...rightSources]) source[index] *= gain;
              }
            }
            const output = new Float32Array(128);
            this.processor.process([
              ...sources.map((source, channel) => settings.stereo ? [source, rightSources[channel]] : [source]),
              settings.stereo ? [mixed, mixedRight] : [mixed]
            ], [[output]]);
            assert.ok(output.every((value) => value === 0), "Measurement worklet must not add audible output.");
          }
        });
      }
    };
    this.processor.port.postMessage = (data) => {
      assert.ok(this.port.onmessage);
      this.port.onmessage({ data });
    };
  }
}

// DOM-shaped shims are installed only in this standalone Node process. Narrow
// through unknown because these intentionally implement just the probe's API.
const environment = globalThis as unknown as {
  AudioNode: typeof SyntheticNode;
  GainNode: typeof SyntheticGain;
  ChannelSplitterNode: typeof SyntheticSplitter;
  AudioContext: typeof SyntheticContext;
  AudioWorkletNode: typeof SyntheticWorklet;
  window: { AudioContext: typeof SyntheticContext; __audioAuditProbe?: AudioAuditProbe };
};
environment.AudioNode = SyntheticNode;
environment.GainNode = SyntheticGain;
environment.ChannelSplitterNode = SyntheticSplitter;
environment.AudioContext = SyntheticContext;
environment.AudioWorkletNode = SyntheticWorklet;
environment.window = { AudioContext: SyntheticContext };
installAudioAuditProbe();
const probe = environment.window.__audioAuditProbe;
assert.ok(probe);

function graph(): SyntheticContext {
  const context = new SyntheticContext();
  const source = context.createMediaElementSource({ getAttribute: () => "Original audio" });
  const splitter = new SyntheticSplitter(context);
  source.connect(splitter);
  for (let index = 0; index < 3; index++) {
    const merger = new SyntheticNode(context);
    // The shim records graph discovery while the actual worklet receives the
    // known PCM below. Both parts are necessary to validate a post-gain probe.
    Reflect.apply(splitter.connect, splitter, [merger, index * 2, 0]);
    Reflect.apply(splitter.connect, splitter, [merger, index * 2 + 1, 1]);
    const gain = new SyntheticGain(context);
    merger.connect(gain);
    gain.connect(context.destination);
    void probe!.ready().then(() => {
      assert.equal(source.connections.some((node) => node instanceof SyntheticWorklet), false,
        "Source measurement must not bypass channel gain.");
      assert.equal(merger.connections.some((node) => node instanceof SyntheticWorklet), false);
      assert.ok(gain.connections.some((node) => node instanceof SyntheticWorklet),
        "Channel measurement must follow the channel gain.");
    });
  }
  return context;
}

const cases: CalibrationCase[] = [];
const withoutPcm = (result: AudioMeasurement): AudioMeasurement => ({ ...result, retainedPcm: undefined });
for (const sampleRate of [48_000, 44_100]) {
  settings = { delaysMs: [0, 0, 0], audible: [true, true, true], sampleRate };
  const context = graph();
  await probe.ready();
  for (const delay of [0, 20, 50, 100, -20, -50, -100]) {
    settings.delaysMs = [0, delay, -delay];
    const result = await probe.capture(1600);
    const expectedLags = [delay, -delay, -2 * delay];
    assert.equal(result.valid, true);
    for (const [index, expected] of expectedLags.entries()) {
      const pair = result.pairs[index];
      assert.equal(pair.confidence, "high");
      assert.notEqual(pair.lagMs, null);
      assert.ok(pair.lagMs !== null && Math.abs(pair.lagMs - expected) <= result.blockDurationMs,
        `Delay calibration failed: ${JSON.stringify({ sampleRate, expected, pair })}`);
    }
    for (const channel of channels) {
      assert.ok(Math.abs(result.mixedToneRms[channel] / result.rms[channel] - 1) < 0.03,
        `Carrier RMS calibration failed for ${channel} at ${sampleRate} Hz.`);
    }
    cases.push({ sampleRate, delaysMs: [...settings.delaysMs], expectedLags, result: withoutPcm(result) });
  }
  for (const audible of [[true, false, false], [false, true, false], [false, false, true], [false, false, false]]) {
    settings.audible = audible;
    const result = await probe.capture(1600);
    channels.forEach((channel, index) => {
      assert.ok(audible[index] ? result.mixedToneRms[channel] > 0.001 : result.mixedToneRms[channel] < 0.00001,
        `Carrier isolation failed for ${channel} at ${sampleRate} Hz.`);
    });
    assert.ok(result.pairs.every((pair) => pair.lagMs === null));
    cases.push({ sampleRate, audible: [...audible], result: withoutPcm(result) });
  }
  context.state = "closed";
}
const pitchCalibration: { semitones: number; result: AudioMeasurement }[] = [];
for (const semitones of [-6, 6]) {
  settings = { delaysMs: [0, 0, 0], audible: [true, true, true], sampleRate: 48_000, transposeSemitones: semitones };
  const context = graph();
  await probe.ready();
  const result = await probe.capture(1600, 1, semitones);
  for (const channel of channels) {
    assert.ok(Math.abs(result.mixedToneRms[channel] / result.rms[channel] - 1) < 0.03,
      `Transposed carrier calibration failed for ${channel} at ${semitones} semitones.`);
  }
  pitchCalibration.push({ semitones, result: withoutPcm(result) });
  context.state = "closed";
}
const stereoCalibration: { semitones: number; result: AudioMeasurement }[] = [];
for (const semitones of [-6, 0, 6]) {
  settings = { delaysMs: [0, 0, 0], audible: [true, true, true], sampleRate: 48_000,
    transposeSemitones: semitones, stereo: true };
  const context = graph();
  await probe.ready();
  const result = await probe.capture(1600, 1, semitones, true);
  assert.ok(result.stereo);
  for (const channel of channels) {
    assert.ok(result.stereo.left[channel] > 0.001 && result.stereo.right[channel] > 0.001);
    assert.ok(Math.abs(result.stereo.left[channel] / result.stereo.right[channel] - 1) < 0.03);
    assert.ok(result.stereo.rightCarriersInLeft[channel] < 0.00001);
    assert.ok(result.stereo.leftCarriersInRight[channel] < 0.00001);
  }
  assert.ok(result.retainedPcm, "Explicit retention must save a clean, below-threshold capture.");
  assert.equal(result.retainedPcm.encoding, "float32-le-base64");
  const rawLeft = Buffer.from(result.retainedPcm.finalLeft, "base64");
  assert.equal(rawLeft.length, result.frames * 4);
  for (const channel of channels) {
    for (const side of ["left", "right"] as const) {
      assert.equal(Buffer.from(result.retainedPcm.postGain[channel][side], "base64").length, result.frames * 4);
    }
  }
  const referenceSample = rawLeft.readFloatLE(1000 * 4);
  const referenceTime = 1 + 1000 / result.sampleRate;
  const expectedSample = audioAuditFrequencies.reduce((sum, frequency) => sum +
    0.025 * audioAuditEnvelope(referenceTime) * Math.sin(2 * Math.PI * frequency * 2 ** (semitones / 12) * referenceTime), 0);
  assert.ok(Math.abs(referenceSample - expectedSample) < (semitones === 0 ? 0.0001 : 1e-7));
  stereoCalibration.push({ semitones, result: withoutPcm(result) });
  context.state = "closed";
}
assert.throws(() => createAudioAuditWav(3, 1));
assert.throws(() => createAudioAuditWav(0, 0));
assert.equal(cases.length, 22);

const discriminatorCalibration: {
  semitones: number;
  durationMs: number;
  fault: StereoFault | null;
  result: AudioMeasurement;
}[] = [];
let positiveRawCandidates = 0, positiveWindowCandidates = 0, positiveCarrierLike = 0;
let negativeCandidates = 0;
for (const semitones of [-6, 0, 6]) {
  settings = { delaysMs: [0, 0, 0], audible: [true, true, true], sampleRate: 48_000,
    transposeSemitones: semitones, stereo: true };
  const context = graph();
  await probe.ready();
  const faults: { fault: StereoFault | null; durationMs: number }[] = [
    { fault: null, durationMs: 160 },
    ...[0.01, 0.03, 0.1].flatMap((amount) => ["right-to-left", "left-to-right"].map((direction) => ({
      fault: { kind: "crossfeed" as const, startMs: 0, durationMs: 200, amount,
        direction: direction as "right-to-left" | "left-to-right" }, durationMs: 200
    }))),
    ...[8, 24, 60].flatMap((durationMs, index) => [20, 80, 140].map((startMs) => ({
      fault: { kind: "crossfeed" as const, startMs, durationMs, amount: 0.5,
        direction: index % 2 ? "left-to-right" as const : "right-to-left" as const }, durationMs: 200
    }))),
    ...[20, 80, 140].flatMap((startMs, index) => [
      { fault: { kind: "impulse" as const, startMs, durationMs: 1000 / 48_000, amount: 0.2 }, durationMs: 160 },
      { fault: { kind: "impulse" as const, startMs, durationMs: 16_000 / 48_000, amount: 0.04 }, durationMs: 180 },
      { fault: { kind: "dropout" as const, startMs, durationMs: [8, 24, 40][index], amount: 0 }, durationMs: 200 },
      { fault: { kind: "gain-step" as const, startMs, durationMs: 200, amount: 0.2 }, durationMs: 200 },
      { fault: { kind: "phase-jump" as const, startMs, durationMs: 200, amount: -1 }, durationMs: 200 }
    ])
  ];
  for (const { fault, durationMs } of faults) {
    settings.fault = fault ?? undefined;
    const result = await probe.capture(durationMs, 1, semitones);
    assert.ok(result.stereoEvidence);
    const all = [...Object.values(result.stereoEvidence.rightCarriersInLeft),
      ...Object.values(result.stereoEvidence.leftCarriersInRight)];
    const suspicious = all.some((item) => item.rawCandidate || item.windowCandidate);
    if (suspicious) assert.ok(result.retainedPcm, "Candidates must preserve diagnostic PCM.");
    if (fault?.kind === "crossfeed") {
      const target = fault.direction === "left-to-right"
        ? Object.values(result.stereoEvidence.leftCarriersInRight)
        : Object.values(result.stereoEvidence.rightCarriersInLeft);
      positiveRawCandidates += target.filter((item) => item.rawCandidate).length;
      positiveWindowCandidates += target.filter((item) => item.windowCandidate).length;
      positiveCarrierLike += target.filter((item) => item.classification === "carrier-like").length;
      // Strong short bursts must never be dismissed as a clean result, even if
      // they do not last long enough to establish a narrow-band carrier.
      if (fault.amount >= 0.5) assert.ok(target.some((item) => item.classification !== "below-threshold"),
        `Missed transient crossfeed: ${JSON.stringify({ semitones, fault, target })}`);
      if (fault.startMs === 0 && fault.amount >= 0.03) {
        assert.ok(target.every((item) => item.classification === "carrier-like"),
          `Sustained crossfeed not corroborated: ${JSON.stringify({ semitones, fault, target })}`);
      }
    } else {
      negativeCandidates += all.filter((item) => item.rawCandidate || item.windowCandidate).length;
      assert.ok(all.every((item) => item.classification !== "carrier-like"),
        `Broadband/clean signal falsely identified as carrier-like: ${JSON.stringify({ semitones, fault, evidence: result.stereoEvidence })}`);
    }
    discriminatorCalibration.push({ semitones, durationMs, fault, result: withoutPcm(result) });
  }
  context.state = "closed";
}

// These PCM inputs model varispeed before pitch correction, while final
// carriers remain at their intended pitch. This calibrates the measurement;
// it does not claim that a production pitch processor has this ideal output.
const varispeedCalibration: {
  sampleRate: number;
  playbackRate: number;
  kind: string;
  delaysMs: number[];
  expectedLags?: number[];
  audible: boolean[];
  carrierPhases: number[];
  result: AudioMeasurement;
}[] = [];
const phaseProfiles = [
  [0, 0, 0, 0, 0, 0],
  [0.17, 1.1, 2.8, 0.7, 2.2, 4.9],
  [Math.PI / 2, 0.3, 4.1, 3.7, Math.PI / 3, 5.6]
];
for (const sampleRate of [48_000, 44_100]) {
  for (const playbackRate of [0.25, 0.5, 0.75, 1]) {
    settings = { delaysMs: [0, 0, 0], audible: [true, true, true], sampleRate,
      stereo: true, varispeedRate: playbackRate };
    const context = graph();
    await probe.ready();
    const variants = [
      ...[0, -8, 8, -16, 16, -24, 24, -64, 64].map((delay, index) => ({
        kind: "known-offset", delaysMs: [0, delay, 0], audible: [true, true, true],
        phases: phaseProfiles[index % phaseProfiles.length], unrelated: false
      })),
      { kind: "zero-with-independent-phases", delaysMs: [0, 0, 0], audible: [true, true, true],
        phases: phaseProfiles[1], unrelated: false },
      { kind: "one-silent", delaysMs: [0, 0, 0], audible: [true, true, false],
        phases: phaseProfiles[2], unrelated: false },
      { kind: "all-silent", delaysMs: [0, 0, 0], audible: [false, false, false],
        phases: phaseProfiles[1], unrelated: false },
      { kind: "unrelated-envelopes", delaysMs: [0, 0, 0], audible: [true, true, true],
        phases: phaseProfiles[2], unrelated: true }
    ];
    for (const variant of variants) {
      settings.delaysMs = variant.delaysMs;
      settings.audible = variant.audible;
      settings.carrierPhases = variant.phases;
      settings.unrelatedEnvelopes = variant.unrelated;
      const result = await probe.capture(4000, playbackRate);
      const expectedLags = [variant.delaysMs[1], 0, -variant.delaysMs[1]];
      assert.equal(result.valid, true);
      for (const [index, pair] of result.pairs.entries()) {
        const audible = variant.audible[channels.indexOf(pair.first)] && variant.audible[channels.indexOf(pair.second)];
        if (!audible || variant.unrelated) {
          assert.notEqual(pair.confidence, "high", `False measurable pair: ${JSON.stringify({ sampleRate, playbackRate, variant, pair })}`);
          assert.equal(pair.lagMs, null);
          continue;
        }
        const expected = expectedLags[index];
        assert.equal(pair.confidence, "high", `Lost measurable pair: ${JSON.stringify({ sampleRate, playbackRate, variant, pair })}`);
        assert.ok(pair.lagMs !== null && Math.abs(pair.lagMs - expected) <= result.blockDurationMs,
          `Varispeed lag calibration failed: ${JSON.stringify({ sampleRate, playbackRate, variant, expected, pair })}`);
        // Preserve the actual 20 ms product gate, including both lag signs.
        assert.equal(Math.abs(pair.lagMs) > 20, Math.abs(expected) > 20,
          `20 ms gate calibration failed: ${JSON.stringify({ sampleRate, playbackRate, expected, pair })}`);
      }
      assert.ok(result.stereo);
      for (const [index, channel] of channels.entries()) {
        assert.ok(variant.audible[index] ? result.mixedToneRms[channel] > 0.001 : result.mixedToneRms[channel] < 0.00001);
        assert.ok(result.stereo.rightCarriersInLeft[channel] < 0.00001);
        assert.ok(result.stereo.leftCarriersInRight[channel] < 0.00001);
      }
      varispeedCalibration.push({ sampleRate, playbackRate, kind: variant.kind,
        delaysMs: [...variant.delaysMs], expectedLags: variant.unrelated ? undefined : expectedLags,
        audible: [...variant.audible], carrierPhases: [...variant.phases], result: withoutPcm(result) });
    }
    context.state = "closed";
  }
}
assert.equal(varispeedCalibration.length, 104);

const outputDirectory = process.env.MIMICOPY_AUDIO_AUDIT_OUTPUT ?? process.env.AUDIO_AUDIT_OUTPUT_DIR ?? "audio-audit.local/manual";
await mkdir(outputDirectory, { recursive: true });
const outputPath = path.join(outputDirectory, "signal-calibration.json");
await writeFile(outputPath, JSON.stringify({
  kind: "Synthetic PCM calibration of actual worklet processor and estimator; not application/browser evidence",
  passed: true,
  envelopeEstimator: "power-mean-4-v1",
  pitchCalibration,
  stereoCalibration,
  discriminatorCalibration,
  varispeedCalibration,
  discriminatorCounts: { positiveRawCandidates, positiveWindowCandidates, positiveCarrierLike, negativeCandidates },
  cases
}, null, 2));
console.log(`Passed ${cases.length} offset/spectral + ${pitchCalibration.length} pitch + ${stereoCalibration.length} stereo + ${discriminatorCalibration.length} transient/crossfeed + ${varispeedCalibration.length} varispeed calibration cases. Results: ${outputPath}`);
