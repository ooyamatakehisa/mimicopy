import {
  defaultMixerState,
  getEffectiveMixerVolume,
  getMixerFollowerPlaybackRate,
  getMixerPlaybackClock,
  shouldHardSyncMixerFollower
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

  it("hard-syncs only muted followers", () => {
    expect(
      shouldHardSyncMixerFollower({
        driftSeconds: 0.08,
        followerVolume: 0
      })
    ).toBe(true);
    expect(
      shouldHardSyncMixerFollower({
        driftSeconds: 0.08,
        followerVolume: 1
      })
    ).toBe(false);
    expect(
      shouldHardSyncMixerFollower({
        driftSeconds: 2,
        followerVolume: 1
      })
    ).toBe(false);
  });

  it("corrects audible drift with small playback-rate changes", () => {
    expect(
      getMixerFollowerPlaybackRate({
        basePlaybackRate: 1,
        currentPlaybackRate: 1,
        driftSeconds: 0.1,
        followerVolume: 1
      })
    ).toBeCloseTo(0.98);
    expect(
      getMixerFollowerPlaybackRate({
        basePlaybackRate: 1,
        currentPlaybackRate: 1,
        driftSeconds: -0.1,
        followerVolume: 1
      })
    ).toBeCloseTo(1.02);
    expect(
      getMixerFollowerPlaybackRate({
        basePlaybackRate: 0.75,
        currentPlaybackRate: 0.75,
        driftSeconds: 0.01,
        followerVolume: 1
      })
    ).toBe(0.75);
    expect(
      getMixerFollowerPlaybackRate({
        basePlaybackRate: 1,
        currentPlaybackRate: 1,
        driftSeconds: 1,
        followerVolume: 1
      })
    ).toBe(0.98);
    expect(
      getMixerFollowerPlaybackRate({
        basePlaybackRate: 1,
        currentPlaybackRate: 1,
        driftSeconds: 0.1,
        followerVolume: 0
      })
    ).toBe(1);
    expect(
      getMixerFollowerPlaybackRate({
        basePlaybackRate: 1,
        currentPlaybackRate: 0.98,
        driftSeconds: 0.02,
        followerVolume: 1
      })
    ).toBe(0.98);
    expect(
      getMixerFollowerPlaybackRate({
        basePlaybackRate: 1,
        currentPlaybackRate: 0.98,
        driftSeconds: 0.005,
        followerVolume: 1
      })
    ).toBe(1);
  });
});
