import { ClickCueDsp } from "./clickCueDsp";

type Cue = { frame: number; duration: number; downbeat?: boolean; amplitude?: number };

function render({ sampleRate = 48_000, latency = 0, frames = 12_000, cues = [], enabled = () => true,
  beforeFrame = () => undefined }: {
  sampleRate?: number;
  latency?: number;
  frames?: number;
  cues?: Cue[];
  enabled?(frame: number): boolean;
  beforeFrame?(frame: number, dsp: ClickCueDsp): void;
}) {
  const dsp = new ClickCueDsp(sampleRate, latency);
  const output = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    beforeFrame(frame, dsp);
    let normal = 0;
    let downbeat = 0;
    for (const cue of cues) {
      if (frame < cue.frame || frame >= cue.frame + cue.duration) continue;
      if (cue.downbeat) downbeat += cue.amplitude ?? 1;
      else normal += cue.amplitude ?? 1;
    }
    output[frame] = dsp.processSample(normal, downbeat, enabled(frame));
  }
  return output;
}

function firstSound(samples: Float32Array) {
  return samples.findIndex((sample) => Math.abs(sample) > 0.000001);
}

describe("sample-domain click cues", () => {
  it.each([44_100, 48_000, 96_000])("delays every sample by the exact rounded DSP latency at %s Hz", (sampleRate) => {
    const latency = 0.12013;
    const delay = Math.round(latency * sampleRate);
    const frames = sampleRate;
    const cues = [{ frame: 173, duration: 48 }, { frame: 20_141, duration: 48, downbeat: true }];
    const direct = render({ sampleRate, frames, cues });
    const delayed = render({ sampleRate, frames, cues, latency });
    expect(delayed.subarray(0, delay).every((sample) => sample === 0)).toBe(true);
    expect(delayed.subarray(delay)).toEqual(direct.subarray(0, frames - delay));
    expect(firstSound(delayed) - firstSound(direct)).toBe(delay);
  });

  it.each([0.25, 0.5, 0.75, 1])("keeps the same click waveform and duration with a native %sx cue pulse", (rate) => {
    const reference = render({ cues: [{ frame: 29, duration: 48 }] });
    const slowedPulse = render({ cues: [{ frame: 29, duration: Math.round(48 / rate) }] });
    expect(slowedPulse).toEqual(reference);
    expect(firstSound(slowedPulse)).toBe(30);
    expect(slowedPulse[29 + 2160 - 1]).not.toBe(0);
    expect(slowedPulse.subarray(29 + 2160).every((sample) => sample === 0)).toBe(true);
  });

  it("does not retrigger a 4 ms pulse from hysteresis-band fluctuations or subthreshold ringing", () => {
    const cues: Cue[] = [{ frame: 17, duration: 192 }];
    const reference = render({ cues });
    const ringing = render({ cues: [...cues,
      { frame: 80, duration: 4, amplitude: -0.7 },
      { frame: 213, duration: 4, amplitude: -0.08 },
      { frame: 219, duration: 4, amplitude: 0.09 },
      { frame: 235, duration: 4, amplitude: 0.04 }
    ] });
    expect(ringing).toEqual(reference);
  });

  it("prioritizes a downbeat when both channels have a cue and never emits the raw pulse", () => {
    const downbeat = render({ cues: [{ frame: 100, duration: 192, downbeat: true }] });
    const both = render({ cues: [{ frame: 100, duration: 192 }, { frame: 100, duration: 192, downbeat: true }] });
    expect(both).toEqual(downbeat);
    expect(Math.max(...downbeat)).toBeLessThanOrEqual(0.14);
    expect(downbeat[100 + 3600 - 1]).not.toBe(0);
    expect(downbeat.subarray(100 + 3600).every((sample) => sample === 0)).toBe(true);
  });

  it("detects the next independent pulse", () => {
    const single = render({ cues: [{ frame: 0, duration: 48 }] });
    const repeated = render({ frames: 18_000, cues: [{ frame: 0, duration: 48 }, { frame: 10_000, duration: 48 }] });
    expect(repeated.subarray(10_000)).toEqual(single.subarray(0, 8000));
  });

  it("detects valid 1 ms pulses separated by a single source sample without a fixed dead period", () => {
    const repeated = render({ cues: [{ frame: 0, duration: 48 }, { frame: 49, duration: 48, downbeat: true }] });
    const second = render({ cues: [{ frame: 49, duration: 48, downbeat: true }] });
    expect(repeated.subarray(49)).toEqual(second.subarray(49));
    expect(repeated.subarray(0, 49).some((sample) => sample !== 0)).toBe(true);
    expect(firstSound(second)).toBe(50);
  });

  it("cuts the active tone immediately, with no tail on re-enable", () => {
    const output = render({ latency: 0.12, cues: [{ frame: 0, duration: 48 }],
      enabled: (frame) => frame < 6100 || frame >= 6101 });
    expect(output.subarray(6100).every((sample) => sample === 0)).toBe(true);
    expect(firstSound(output)).toBe(5761);
  });

  it.each([1000, 5760, 5761])("enabling at frame %s only clicks if the beat has not passed its audible due frame", (enableFrame) => {
    const output = render({ latency: 0.12, cues: [{ frame: 0, duration: 48 }],
      enabled: (frame) => frame >= enableFrame });
    expect(firstSound(output)).toBe(enableFrame <= 5760 ? 5761 : -1);
  });

  it("drops events due while disabled and retains the next future event", () => {
    const output = render({ latency: 0.12,
      cues: [{ frame: 0, duration: 48 }, { frame: 3000, duration: 48 }],
      enabled: (frame) => frame < 5650 || frame >= 5850 });
    expect(firstSound(output)).toBe(8761);
  });

  it("tracks cue edges while disabled and does not replay a pulse when enabled midway through it", () => {
    const output = render({ cues: [{ frame: 0, duration: 192 }, { frame: 1000, duration: 48 }],
      enabled: (frame) => frame >= 100 });
    expect(firstSound(output)).toBe(1001);
  });

  it("preserves future events during rapid disable/enable transitions without duplicating the current cue edge", () => {
    const output = render({ latency: 0.12, cues: [{ frame: 0, duration: 192 }],
      beforeFrame(frame, dsp) {
        if (frame === 100) { dsp.setEnabled(false); dsp.setEnabled(true); }
      } });
    expect(output).toEqual(render({ latency: 0.12, cues: [{ frame: 0, duration: 192 }] }));
  });

  it("resets delayed events, synthesis tails, and cue edges on transport prepare", () => {
    const restarted = render({ latency: 0.12, frames: 14_000,
      cues: [{ frame: 0, duration: 192 }, { frame: 200, duration: 48, downbeat: true }],
      beforeFrame(frame, dsp) { if (frame === 200) dsp.reset(); } });
    const reference = render({ latency: 0.12, frames: 14_000,
      cues: [{ frame: 200, duration: 48, downbeat: true }] });
    expect(restarted).toEqual(reference);
  });

  it.each([false, true])("synthesizes a bandlimited %s downbeat square with the original exponential envelope", (downbeat) => {
    const sampleRate = 48_000;
    const frequency = downbeat ? 1760 : 1120;
    const volume = downbeat ? 0.14 : 0.075;
    const duration = downbeat ? 0.075 : 0.045;
    const output = render({ sampleRate, cues: [{ frame: 0, duration: 48, downbeat }] });
    // Remove the specified gain envelope, then inspect an integer-period window
    // of the actual rendered signal. A naive square would fail the alias check.
    const signal = Array.from(output.subarray(240, 1440), (sample, index) => {
      const time = (index + 240) / sampleRate;
      const envelope = volume * (0.0001 / volume) ** ((time - 0.002) / (duration - 0.002));
      return sample / envelope;
    });
    const magnitude = (hz: number) => {
      let real = 0;
      let imaginary = 0;
      for (const [index, sample] of signal.entries()) {
        const phase = 2 * Math.PI * hz * index / sampleRate;
        real += sample * Math.cos(phase);
        imaginary += sample * Math.sin(phase);
      }
      return Math.hypot(real, imaginary) / signal.length;
    };
    const fundamental = magnitude(frequency);
    expect(fundamental).toBeGreaterThan(0.5);
    expect(magnitude(frequency * 3) / fundamental).toBeCloseTo(1 / 3, 4);
    expect(magnitude(frequency * 2) / fundamental).toBeLessThan(0.0001);
    const firstAliasedOddHarmonic = downbeat ? 15 : 23;
    expect(magnitude(sampleRate - frequency * firstAliasedOddHarmonic) / fundamental).toBeLessThan(0.0001);
  });
});
