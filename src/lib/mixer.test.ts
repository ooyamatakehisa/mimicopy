import {
  defaultMixerState,
  getEffectiveMixerVolume,
  getMixerPlaybackClock,
  shouldResyncMixerFollower
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

  it("uses the audible stem as clock when the original is muted", () => {
    expect(
      getMixerPlaybackClock({
        hasRemainder: true,
        hasStem: true,
        originalVolume: 0,
        remainderVolume: 1,
        stemVolume: 1
      })
    ).toBe("stem");
    expect(
      getMixerPlaybackClock({
        hasRemainder: true,
        hasStem: true,
        originalVolume: 1,
        remainderVolume: 1,
        stemVolume: 1
      })
    ).toBe("original");
    expect(
      getMixerPlaybackClock({
        hasRemainder: false,
        hasStem: false,
        originalVolume: 0,
        remainderVolume: 1,
        stemVolume: 1
      })
    ).toBe("original");
    expect(
      getMixerPlaybackClock({
        hasRemainder: true,
        hasStem: true,
        originalVolume: 0,
        remainderVolume: 1,
        stemVolume: 0
      })
    ).toBe("remainder");
  });

  it("hard-syncs muted followers without repeatedly seeking audible audio", () => {
    expect(
      shouldResyncMixerFollower({
        driftSeconds: 0.08,
        followerVolume: 0
      })
    ).toBe(true);
    expect(
      shouldResyncMixerFollower({
        driftSeconds: 0.08,
        followerVolume: 1
      })
    ).toBe(false);
    expect(
      shouldResyncMixerFollower({
        driftSeconds: 0.51,
        followerVolume: 1
      })
    ).toBe(true);
  });
});
