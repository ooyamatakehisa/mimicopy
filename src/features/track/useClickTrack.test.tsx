import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BeatGrid } from "../../lib/beats";
import { useClickTrack } from "./useClickTrack";
import type { PlaybackState } from "./usePlaybackState";

const beatGrid: BeatGrid = {
  analyzedAt: "2026-07-20T00:00:00.000Z",
  beats: [{ isDownbeat: true, position: 1, time: 0.5 }],
  beatsPerBar: [4],
  downbeats: [0.5],
  source: "madmom"
};

describe("useClickTrack", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the shared audio context without taking ownership of it", () => {
    const audio = document.createElement("audio");
    const destination = {} as AudioDestinationNode;
    const close = vi.fn(() => Promise.resolve());
    const resume = vi.fn(() => Promise.resolve());
    const audioContext = {
      currentTime: 0,
      destination,
      close,
      resume
    } as unknown as AudioContext;

    const playback = {
      audioRef: { current: audio },
      currentTime: 0,
      isPlaying: false,
      playbackRate: 1
    } as unknown as PlaybackState;
    const { result, unmount } = renderHook(() =>
      useClickTrack({
        audioContext,
        beatGrid,
        outputLatencySeconds: 0,
        playback
      })
    );

    act(() => {
      result.current.toggleClickTrack();
    });

    expect(resume).toHaveBeenCalledOnce();

    act(() => {
      result.current.toggleClickTrack();
      result.current.toggleClickTrack();
    });

    expect(resume).toHaveBeenCalledTimes(2);

    unmount();
    expect(close).not.toHaveBeenCalled();
  });
});
