import {
  defaultMixerState,
  getEffectiveMixerVolume
} from "./mixer";

describe("mixer helpers", () => {
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
});
