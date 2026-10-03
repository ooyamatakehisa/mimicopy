import {
  defaultMixerState,
  getEffectiveMixerVolume,
  getMixerGainAtTime
} from "./mixer";

describe("mixer helpers", () => {
  it("preserves the instantaneous level when a fade is interrupted", () => {
    const fadeOut = { from: 1, to: 0, startTime: 1, endTime: 1.008 };
    expect(getMixerGainAtTime(fadeOut, 0)).toBe(1);
    expect(getMixerGainAtTime(fadeOut, 1.004)).toBeCloseTo(0.5);
    expect(getMixerGainAtTime(fadeOut, 2)).toBe(0);
    const reversed = { from: getMixerGainAtTime(fadeOut, 1.004), to: 1,
      startTime: 1.004, endTime: 1.012 };
    expect(getMixerGainAtTime(reversed, 1.004)).toBeCloseTo(0.5);
    expect(getMixerGainAtTime(reversed, 1.008)).toBeCloseTo(0.75);
    expect(getMixerGainAtTime(reversed, 2)).toBe(1);
    expect(getMixerGainAtTime({ from: 0.4, to: 0.4, startTime: 0, endTime: 0 }, 0)).toBe(0.4);
  });

  it("applies volume, mute, and solo to each channel", () => {
    expect(
      getEffectiveMixerVolume(
        {
          ...defaultMixerState,
          original: { muted: false, solo: false, volume: 0.4 }
        },
        "original"
      )
    ).toBe(0.4);
    expect(
      getEffectiveMixerVolume(
        {
          ...defaultMixerState,
          original: { muted: true, solo: false, volume: 0.4 }
        },
        "original"
      )
    ).toBe(0);
    expect(
      getEffectiveMixerVolume(
        {
          ...defaultMixerState,
          original: { muted: false, solo: false, volume: 0.4 },
          stem: { muted: false, solo: true, volume: 0.7 }
        },
        "original"
      )
    ).toBe(0);
    expect(
      getEffectiveMixerVolume(
        {
          ...defaultMixerState,
          original: { muted: false, solo: false, volume: 0.4 },
          stem: { muted: false, solo: true, volume: 0.7 }
        },
        "stem"
      )
    ).toBe(0.7);
  });

  it("keeps mute dominant over solo and preserves multiple solos", () => {
    const channels = {
      original: { muted: true, solo: true, volume: 1 },
      stem: { muted: false, solo: true, volume: 0.5 },
      remainder: { muted: false, solo: true, volume: 0.8 }
    };
    expect(getEffectiveMixerVolume(channels, "original")).toBe(0);
    expect(getEffectiveMixerVolume(channels, "stem")).toBe(0.5);
    expect(getEffectiveMixerVolume(channels, "remainder")).toBe(0.8);
  });
});
