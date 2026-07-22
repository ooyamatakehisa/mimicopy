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

  it("routes the media element and clicks through the same audio context", () => {
    const audio = document.createElement("audio");
    const destination = {} as AudioDestinationNode;
    const connect = vi.fn();
    const disconnect = vi.fn();
    const close = vi.fn(() => Promise.resolve());
    const resume = vi.fn(() => Promise.resolve());
    const createMediaElementSource = vi.fn(() => ({
      connect,
      disconnect
    }));

    class SynchronizedAudioContextMock {
      currentTime = 0;
      destination = destination;
      close = close;
      createMediaElementSource = createMediaElementSource;
      resume = resume;
    }

    vi.stubGlobal(
      "AudioContext",
      SynchronizedAudioContextMock as unknown as typeof AudioContext
    );

    const playback = {
      audioRef: { current: audio },
      currentTime: 0,
      isPlaying: false,
      playbackRate: 1
    } as unknown as PlaybackState;
    const { result, unmount } = renderHook(() =>
      useClickTrack({ beatGrid, playback })
    );

    act(() => {
      result.current.toggleClickTrack();
    });

    expect(createMediaElementSource).toHaveBeenCalledOnce();
    expect(createMediaElementSource).toHaveBeenCalledWith(audio);
    expect(connect).toHaveBeenCalledWith(destination);
    expect(resume).toHaveBeenCalledOnce();

    act(() => {
      result.current.toggleClickTrack();
      result.current.toggleClickTrack();
    });

    expect(createMediaElementSource).toHaveBeenCalledOnce();

    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
});
