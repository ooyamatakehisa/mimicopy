import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePlaybackState } from "./usePlaybackState";

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function media() {
  let paused = true;
  let readyState = 4;
  let seeking = false;
  let ended = false;
  let time = 0;
  const element = document.createElement("audio");
  Object.defineProperties(element, {
    paused: { get: () => paused },
    duration: { value: 30 },
    readyState: { get: () => readyState },
    seeking: { get: () => seeking },
    ended: { get: () => ended },
    currentTime: {
      get: () => time,
      set: (value: number) => { time = value; seeking = readyState >= 1; }
    }
  });
  const play = vi.spyOn(element, "play").mockImplementation(() => {
    paused = false;
    return Promise.resolve();
  });
  const pause = vi.spyOn(element, "pause").mockImplementation(() => { paused = true; });
  const load = vi.spyOn(element, "load").mockImplementation(() => {
    paused = true;
    readyState = 0;
    seeking = false;
    time = 0;
  });
  return {
    element, play, pause, load,
    setPaused: (value: boolean) => { paused = value; },
    setEnded: (value: boolean) => { ended = value; },
    setTime: (value: number) => { time = value; },
    metadata: () => { readyState = 1; },
    seeked: () => { seeking = false; readyState = 4; }
  };
}

function processing(element: HTMLMediaElement) {
  return {
    element,
    latencySeconds: 0,
    silence: vi.fn(() => {}),
    prepare: vi.fn(async () => {}),
    open: vi.fn(() => {})
  };
}

const disposeBindings: (() => void)[] = [];
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const hook = renderHook(() => usePlaybackState({ initialDuration: 30, trackDuration: 30, trackId: "test" }), {
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  });
  const original = media();
  hook.result.current.audioRef.current = original.element;
  const resume = vi.fn(async () => {});
  hook.result.current.audioContextRef.current = { state: "suspended", resume } as unknown as AudioContext;
  let disposeBinding = () => {};
  act(() => { disposeBinding = hook.result.current.bindAudio(original.element); });
  disposeBindings.push(disposeBinding);
  const metadata = () => act(() => {
    original.metadata();
    hook.result.current.restoreMetadata(original.element);
  });
  const seeked = () => act(() => {
    original.seeked();
    hook.result.current.restoreSeeked(original.element);
  });
  return { ...hook, original, resume, metadata, seeked, disposeBinding };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  act(() => { disposeBindings.splice(0).forEach((dispose) => dispose()); });
  cleanup();
  vi.useRealTimers();
});

describe("playback restoration", () => {
  it("starts the first play and context synchronously without reloading", () => {
    const { result, original, resume } = setup();
    const control = processing(original.element);
    result.current.audioProcessingRef.current = control;
    act(() => result.current.togglePlayback());
    expect(resume).toHaveBeenCalledOnce();
    expect(original.play).toHaveBeenCalledOnce();
    expect(result.current.isPlayPending).toBe(true);
    expect(original.load).not.toHaveBeenCalled();
    expect(control.open).toHaveBeenCalledOnce();
    expect(control.open.mock.invocationCallOrder[0]).toBeLessThan(original.play.mock.invocationCallOrder[0]!);
    expect(control.prepare).not.toHaveBeenCalled();
  });

  it("does not advance native audio before its output graph is ready", () => {
    const { result, original } = setup();
    result.current.audioContextRef.current = null;
    act(() => result.current.togglePlayback());
    expect(original.play).not.toHaveBeenCalled();
    expect(original.element.currentTime).toBe(0);
  });

  it("primes reload on pause, preserves the cursor, and resumes only after seeked", () => {
    const { result, original, resume, metadata, seeked } = setup();
    act(() => result.current.togglePlayback());
    original.setTime(12);
    act(() => result.current.togglePlayback());
    expect(original.load).toHaveBeenCalledOnce();
    expect(result.current.currentTime).toBe(12);
    expect(result.current.isPreparing).toBe(true);
    expect(result.current.isPlayPending).toBe(false);
    act(() => { result.current.syncMediaTime(0); result.current.markPaused(); });
    expect(result.current.currentTime).toBe(12);
    act(() => result.current.togglePlayback());
    expect(resume).toHaveBeenCalledTimes(2);
    expect(result.current.isPlayPending).toBe(true);
    expect(original.play).toHaveBeenCalledTimes(1);
    metadata();
    expect(original.element.currentTime).toBe(12);
    expect(original.play).toHaveBeenCalledTimes(1);
    seeked();
    expect(original.play).toHaveBeenCalledTimes(2);
    act(() => result.current.markPlaying());
    expect(result.current.isPreparing).toBe(false);
    expect(original.load).toHaveBeenCalledOnce();
  });

  it("reuses a completed pause reload for the next trusted play", () => {
    const { result, original, metadata, seeked } = setup();
    act(() => result.current.togglePlayback());
    original.setTime(6);
    act(() => result.current.togglePlayback());
    metadata();
    seeked();
    expect(original.play).toHaveBeenCalledTimes(1);
    act(() => result.current.togglePlayback());
    expect(original.play).toHaveBeenCalledTimes(2);
    expect(original.load).toHaveBeenCalledOnce();
  });

  it("keeps paused marker seeks paused and restores only the newest seek", () => {
    const { result, original, metadata, seeked } = setup();
    act(() => result.current.seekTo(8));
    metadata();
    act(() => result.current.seekTo(18));
    expect(original.load).toHaveBeenCalledTimes(2);
    // An old seeked event cannot finish a newer load's metadata stage.
    seeked();
    expect(result.current.isPreparing).toBe(true);
    expect(result.current.currentTime).toBe(18);
    metadata();
    seeked();
    expect(original.element.currentTime).toBe(18);
    expect(original.play).not.toHaveBeenCalled();
    expect(result.current.isPreparing).toBe(false);
  });

  it("cancels a queued replay when Stop is pressed during a playing seek", () => {
    const { result, original, metadata, seeked } = setup();
    act(() => result.current.togglePlayback());
    act(() => result.current.seekTo(9));
    expect(result.current.isPlayPending).toBe(true);
    act(() => result.current.togglePlayback());
    expect(result.current.isPlayPending).toBe(false);
    metadata();
    seeked();
    expect(original.play).toHaveBeenCalledTimes(1);
    expect(original.element.paused).toBe(true);
    expect(result.current.currentTime).toBe(9);
  });

  it("stops at the end instead of restarting when a playing seek reaches duration", () => {
    const { result, original, metadata, seeked } = setup();
    act(() => result.current.togglePlayback());
    act(() => result.current.seekTo(40));
    metadata();
    seeked();
    expect(result.current.currentTime).toBe(30);
    expect(result.current.isPlayPending).toBe(false);
    expect(original.play).toHaveBeenCalledTimes(1);
    expect(original.element.paused).toBe(true);
  });

  it("does not let an aborted old play reject a newer restored playback", async () => {
    const { result, original, metadata, seeked } = setup();
    const first = deferred();
    original.play.mockImplementationOnce(() => { original.setPaused(false); return first.promise; });
    act(() => result.current.togglePlayback());
    act(() => result.current.togglePlayback());
    act(() => result.current.togglePlayback());
    metadata();
    seeked();
    await act(async () => {
      result.current.markPlaying();
      first.reject(new DOMException("Interrupted by load", "AbortError"));
      await Promise.resolve();
    });
    expect(result.current.isPlaying).toBe(true);
    expect(result.current.playbackError).toBeNull();
    expect(original.element.paused).toBe(false);
  });

  it("ignores late pause/play events during restoration", () => {
    const { result, original } = setup();
    act(() => result.current.togglePlayback());
    act(() => result.current.seekTo(7));
    act(() => { result.current.markPaused(); result.current.markPlaying(); });
    expect(result.current.isPlayPending).toBe(true);
    expect(result.current.isPlaying).toBe(false);
    expect(original.play).toHaveBeenCalledTimes(1);
  });

  it("times out a stalled restore, preserves its cursor, and retries on Play", () => {
    const { result, original } = setup();
    act(() => result.current.seekTo(11));
    act(() => { vi.advanceTimersByTime(15_000); });
    expect(result.current.isPreparing).toBe(false);
    expect(result.current.playbackError).toContain("再生位置を準備できません");
    expect(result.current.currentTime).toBe(11);
    act(() => {
      result.current.syncMediaTime(0);
      result.current.restoreSeeked(original.element);
    });
    expect(result.current.currentTime).toBe(11);
    act(() => result.current.togglePlayback());
    expect(original.load).toHaveBeenCalledTimes(2);
    expect(result.current.isPlayPending).toBe(true);
  });

  it("clears restoration on media errors and ignores later seeked events", () => {
    const { result, original, metadata, seeked } = setup();
    act(() => result.current.togglePlayback());
    act(() => result.current.seekTo(14));
    act(() => result.current.reportMediaError("音源"));
    metadata();
    seeked();
    expect(result.current.isPreparing).toBe(false);
    expect(result.current.playbackError).toContain("音源を読み込めません");
    expect(original.play).toHaveBeenCalledTimes(1);
  });

  it("cancels timers and pending replay when the bound source unmounts", () => {
    const { result, original, disposeBinding } = setup();
    act(() => result.current.togglePlayback());
    act(() => result.current.seekTo(5));
    act(disposeBinding);
    act(() => {
      original.metadata();
      result.current.restoreMetadata(original.element);
      original.seeked();
      result.current.restoreSeeked(original.element);
      vi.advanceTimersByTime(15_000);
    });
    expect(original.play).toHaveBeenCalledTimes(1);
    expect(original.element.paused).toBe(true);
    expect(result.current.isPreparing).toBe(false);
    expect(result.current.playbackError).toBeNull();
  });

  it("sets initial native varispeed without reloading an uninitialized graph", () => {
    const { result, original, rerender } = setup();
    act(() => result.current.syncPlaybackRate(0.75));
    rerender();
    expect(original.load).not.toHaveBeenCalled();
    expect(original.element.preservesPitch).toBe(false);
    expect(original.element.playbackRate).toBe(0.75);
    expect(original.element.defaultPlaybackRate).toBe(0.75);
  });

  it("waits for media readiness even when processor preparation finishes first", async () => {
    const { result, original, metadata, seeked } = setup();
    const control = processing(original.element);
    result.current.audioProcessingRef.current = control;
    act(() => result.current.togglePlayback());
    await act(async () => {
      result.current.seekTo(12);
      await Promise.resolve();
    });
    expect(original.play).toHaveBeenCalledTimes(1);
    expect(result.current.isPreparing).toBe(true);
    metadata();
    expect(original.play).toHaveBeenCalledTimes(1);
    seeked();
    expect(original.play).toHaveBeenCalledTimes(2);
    expect(control.open).toHaveBeenCalledTimes(2);
    expect(control.silence.mock.invocationCallOrder[0]).toBeLessThan(original.pause.mock.invocationCallOrder[0]!);
  });

  it("does not let an older processor reset finish a newer seek", async () => {
    const { result, original, metadata, seeked } = setup();
    const first = deferred();
    const second = deferred();
    const control = processing(original.element);
    control.prepare.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    result.current.audioProcessingRef.current = control;
    act(() => result.current.togglePlayback());
    act(() => result.current.seekTo(7));
    metadata();
    seeked();
    act(() => result.current.seekTo(19));
    metadata();
    seeked();
    await act(async () => { first.resolve(); await Promise.resolve(); });
    expect(result.current.isPreparing).toBe(true);
    expect(original.play).toHaveBeenCalledTimes(1);
    expect(control.open).toHaveBeenCalledTimes(1);
    await act(async () => { second.resolve(); await Promise.resolve(); });
    expect(original.play).toHaveBeenCalledTimes(2);
    expect(control.open).toHaveBeenCalledTimes(2);
    expect(original.element.currentTime).toBe(19);
  });

  it("keeps Stop effective while processor preparation is pending", async () => {
    const { result, original, metadata, seeked } = setup();
    const ready = deferred();
    const control = processing(original.element);
    control.prepare.mockImplementation(() => ready.promise);
    result.current.audioProcessingRef.current = control;
    act(() => result.current.togglePlayback());
    act(() => result.current.seekTo(9));
    metadata();
    seeked();
    act(() => result.current.togglePlayback());
    await act(async () => { ready.resolve(); await Promise.resolve(); });
    expect(original.play).toHaveBeenCalledTimes(1);
    expect(control.open).toHaveBeenCalledTimes(1);
    expect(original.element.paused).toBe(true);
    expect(result.current.isPreparing).toBe(false);
    expect(result.current.currentTime).toBe(9);
  });

  it("ignores processor failure from an obsolete seek but reports a current failure", async () => {
    const { result, original } = setup();
    const first = deferred();
    const second = deferred();
    const control = processing(original.element);
    control.prepare.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    result.current.audioProcessingRef.current = control;
    act(() => result.current.seekTo(7));
    act(() => result.current.seekTo(19));
    await act(async () => { first.reject(new Error("old reset")); await Promise.resolve(); });
    expect(result.current.playbackError).toBeNull();
    expect(result.current.isPreparing).toBe(true);
    await act(async () => { second.reject(new Error("current reset")); await Promise.resolve(); });
    expect(result.current.playbackError).toBe("current reset");
    expect(result.current.isPreparing).toBe(false);
    expect(control.open).not.toHaveBeenCalled();
    expect(original.element.paused).toBe(true);
  });

  it("ends current preparation immediately when graph failure clears the shared control before rejection", async () => {
    const { result, original } = setup();
    const ready = deferred();
    const control = processing(original.element);
    control.prepare.mockImplementation(() => ready.promise);
    result.current.audioProcessingRef.current = control;
    act(() => result.current.togglePlayback());
    act(() => result.current.seekTo(9));
    await act(async () => {
      result.current.audioProcessingRef.current = null;
      result.current.audioContextRef.current = null;
      ready.reject(new Error("Audio processor failed"));
      await Promise.resolve();
    });
    expect(result.current.isPreparing).toBe(false);
    expect(result.current.isPlayPending).toBe(false);
    expect(result.current.playbackError).toBe("Audio processor failed");
    expect(original.element.paused).toBe(true);
    expect(original.play).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(15_000); });
    expect(result.current.playbackError).toBe("Audio processor failed");
  });

  it("pauses before changing native rate and waits for the new processor settings", async () => {
    const { result, original, metadata, seeked } = setup();
    const ready = deferred();
    const control = processing(original.element);
    control.prepare.mockImplementation(() => ready.promise);
    result.current.audioProcessingRef.current = control;
    act(() => result.current.togglePlayback());
    original.setTime(8);
    const setRate = vi.spyOn(original.element, "playbackRate", "set");
    act(() => result.current.syncPlaybackRate(0.5));
    expect(control.silence.mock.invocationCallOrder[0]).toBeLessThan(original.pause.mock.invocationCallOrder[0]!);
    expect(original.pause.mock.invocationCallOrder[0]).toBeLessThan(setRate.mock.invocationCallOrder[0]!);
    expect(setRate.mock.invocationCallOrder[0]).toBeLessThan(original.load.mock.invocationCallOrder[0]!);
    expect(original.element.playbackRate).toBe(0.5);
    expect(original.element.defaultPlaybackRate).toBe(0.5);
    expect(original.element.preservesPitch).toBe(false);
    expect(result.current.currentTime).toBe(8);
    metadata();
    seeked();
    expect(original.play).toHaveBeenCalledTimes(1);
    await act(async () => { ready.resolve(); await Promise.resolve(); });
    expect(original.play).toHaveBeenCalledTimes(2);
    expect(original.element.currentTime).toBe(8);
  });

  it("keeps a paused rate change paused and coalesces later rate intent through a new restore", async () => {
    const { result, original, metadata, seeked } = setup();
    const first = deferred();
    const second = deferred();
    const control = processing(original.element);
    control.latencySeconds = 0.12;
    control.prepare.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    result.current.audioProcessingRef.current = control;
    original.setTime(13);
    act(() => result.current.syncPlaybackRate(0.5));
    act(() => result.current.syncPlaybackRate(0.25));
    metadata();
    seeked();
    await act(async () => { first.resolve(); second.resolve(); await Promise.resolve(); });
    expect(original.element.playbackRate).toBe(0.25);
    expect(original.element.currentTime).toBe(13);
    expect(original.play).not.toHaveBeenCalled();
    expect(control.open).not.toHaveBeenCalled();
    expect(result.current.isPreparing).toBe(false);
    act(() => result.current.syncPlaybackRate(0.25));
    expect(original.load).toHaveBeenCalledTimes(2);
  });

  it("drains natural end without silencing but closes the gate on explicit Pause", () => {
    const { result, original } = setup();
    const control = processing(original.element);
    result.current.audioProcessingRef.current = control;
    act(() => result.current.togglePlayback());
    original.setTime(30);
    original.setPaused(true);
    original.setEnded(true);
    act(() => { result.current.markPaused(); result.current.markEnded(); });
    expect(control.silence).not.toHaveBeenCalled();
    expect(control.prepare).not.toHaveBeenCalled();
    expect(result.current.isPlaying).toBe(false);
    original.setEnded(false);
    original.setPaused(false);
    act(() => result.current.togglePlayback());
    expect(control.silence).toHaveBeenCalledOnce();
    expect(control.prepare).toHaveBeenCalledOnce();
  });

  it("never opens a replacement processor after an old preparation resolves", async () => {
    const { result, original, metadata, seeked, disposeBinding } = setup();
    const ready = deferred();
    const previous = processing(original.element);
    previous.prepare.mockImplementation(() => ready.promise);
    result.current.audioProcessingRef.current = previous;
    act(() => result.current.togglePlayback());
    act(() => result.current.seekTo(10));
    metadata();
    seeked();
    act(disposeBinding);
    const replacement = processing(document.createElement("audio"));
    result.current.audioProcessingRef.current = replacement;
    await act(async () => { ready.resolve(); await Promise.resolve(); });
    expect(original.play).toHaveBeenCalledTimes(1);
    expect(previous.open).toHaveBeenCalledTimes(1);
    expect(replacement.open).not.toHaveBeenCalled();
    expect(replacement.silence).not.toHaveBeenCalled();
  });

  it("uses the audible cursor for markers, relative seeks, and pause/resume without skipping the DSP tail", async () => {
    const { result, original, metadata, seeked } = setup();
    const control = processing(original.element);
    control.latencySeconds = 0.12;
    result.current.audioProcessingRef.current = control;
    act(() => result.current.togglePlayback());
    original.setTime(10);
    act(() => result.current.syncMediaTime(10));
    expect(result.current.currentTime).toBeCloseTo(9.88);
    act(() => result.current.togglePlayback());
    expect(result.current.currentTime).toBeCloseTo(9.88);
    metadata();
    seeked();
    await act(async () => { await Promise.resolve(); });
    expect(original.element.currentTime).toBeCloseTo(9.88);
    act(() => result.current.togglePlayback());
    original.setTime(10.2);
    act(() => result.current.syncMediaTime(10.2));
    expect(result.current.currentTime).toBeCloseTo(10.08);
    act(() => result.current.seekBySeconds(5));
    expect(result.current.currentTime).toBeCloseTo(15.08);
  });

  it("clamps audible startup to the most recent seek anchor", async () => {
    const { result, original, metadata, seeked } = setup();
    const control = processing(original.element);
    control.latencySeconds = 0.12;
    result.current.audioProcessingRef.current = control;
    act(() => result.current.seekTo(8));
    metadata();
    seeked();
    await act(async () => { await Promise.resolve(); });
    act(() => result.current.togglePlayback());
    original.setTime(8.04);
    act(() => result.current.syncMediaTime(8.04));
    expect(result.current.currentTime).toBe(8);
    act(() => result.current.togglePlayback());
    expect(result.current.currentTime).toBe(8);
  });

  it("computes a rate-change restart from the old rate's audible position", async () => {
    const { result, original, metadata, seeked } = setup();
    act(() => result.current.syncPlaybackRate(0.5));
    const control = processing(original.element);
    control.latencySeconds = 0.12;
    result.current.audioProcessingRef.current = control;
    act(() => result.current.togglePlayback());
    original.setTime(8);
    act(() => result.current.syncPlaybackRate(0.25));
    expect(result.current.currentTime).toBeCloseTo(7.94);
    expect(original.element.playbackRate).toBe(0.25);
    metadata();
    seeked();
    await act(async () => { await Promise.resolve(); });
    expect(original.element.currentTime).toBeCloseTo(7.94);
    original.setTime(7.95);
    act(() => result.current.syncMediaTime(7.95));
    expect(result.current.currentTime).toBeCloseTo(7.94);
  });

  it("keeps play intent and the audible cursor advancing until the natural-end tail drains", () => {
    const { result, original } = setup();
    const control = processing(original.element);
    control.latencySeconds = 0.12;
    result.current.audioProcessingRef.current = control;
    act(() => result.current.togglePlayback());
    original.setTime(30);
    original.setPaused(true);
    original.setEnded(true);
    act(() => { result.current.markPaused(); result.current.markEnded(); });
    expect(result.current.isPlaying).toBe(true);
    expect(result.current.currentTime).toBeCloseTo(29.88);
    act(() => { vi.advanceTimersByTime(60); result.current.syncMediaTime(30); });
    expect(result.current.currentTime).toBeCloseTo(29.94);
    expect(result.current.isPlaying).toBe(true);
    act(() => { vi.advanceTimersByTime(61); });
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.currentTime).toBe(30);
    expect(control.silence).not.toHaveBeenCalled();
    expect(control.prepare).not.toHaveBeenCalled();
  });

  it("stops and preserves the heard position during natural-end draining", () => {
    const { result, original } = setup();
    const control = processing(original.element);
    control.latencySeconds = 0.12;
    result.current.audioProcessingRef.current = control;
    act(() => result.current.togglePlayback());
    original.setTime(30);
    original.setPaused(true);
    original.setEnded(true);
    act(() => result.current.markEnded());
    act(() => { vi.advanceTimersByTime(60); result.current.togglePlayback(); });
    expect(result.current.currentTime).toBeCloseTo(29.94);
    expect(control.silence).toHaveBeenCalledOnce();
    expect(control.prepare).toHaveBeenCalledOnce();
    act(() => { vi.advanceTimersByTime(100); });
    expect(result.current.currentTime).toBeCloseTo(29.94);
    expect(result.current.isPlaying).toBe(false);
  });
});
