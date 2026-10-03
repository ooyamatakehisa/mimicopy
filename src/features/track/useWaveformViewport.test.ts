import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useWaveformViewport } from "./useWaveformViewport";

describe("waveform viewport navigation", () => {
  it("keeps a manually inspected range while playback advances, then resumes following", () => {
    const { result, rerender } = renderHook(useWaveformViewport, { initialProps: { currentTime: 0, duration: 120 } });
    act(() => result.current.scaleWaveformZoomContinuously(4));
    act(() => result.current.panWaveform(2));
    expect(result.current.waveformRange).toEqual({ start: 60, end: 90 });
    expect(result.current.isFollowingPlayback).toBe(false);
    rerender({ currentTime: 5, duration: 120 });
    expect(result.current.waveformRange).toEqual({ start: 60, end: 90 });
    act(() => result.current.followPlayback());
    expect(result.current.waveformRange).toEqual({ start: 0, end: 30 });
    expect(result.current.isFollowingPlayback).toBe(true);
    rerender({ currentTime: 80, duration: 120 });
    expect(result.current.waveformRange.start).toBeGreaterThan(50);
    expect(result.current.waveformRange.end).toBeGreaterThan(80);
  });

  it("zooms around the inspected region and clamps it when duration changes", () => {
    const { result, rerender } = renderHook(useWaveformViewport, { initialProps: { currentTime: 0, duration: 120 } });
    act(() => result.current.scaleWaveformZoomContinuously(4));
    act(() => result.current.panWaveform(2));
    act(() => result.current.changeWaveformZoom("in"));
    expect(result.current.waveformRange).toEqual({ start: 67.5, end: 82.5 });
    rerender({ currentTime: 0, duration: 40 });
    expect(result.current.waveformRange).toEqual({ start: 35, end: 40 });
    act(() => result.current.scaleWaveformZoomContinuously(1 / 8));
    expect(result.current.waveformRange).toEqual({ start: 0, end: 40 });
    expect(result.current.isFollowingPlayback).toBe(true);
  });
});
