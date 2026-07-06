import { describe, expect, it } from "vitest";
import {
  buildWaveformPeaks,
  centerWaveformRange,
  getWaveformRange,
  keepTimeInWaveformRange,
  nextWaveformZoom,
  timeToWaveformPercent,
  waveformPercentToTime
} from "./waveform";

describe("waveform helpers", () => {
  it("summarizes audio samples into min/max peaks", () => {
    const peaks = buildWaveformPeaks(
      {
        duration: 1,
        getChannelData: () => new Float32Array([-1, 0.5, -0.25, 1]),
        length: 4,
        numberOfChannels: 1
      },
      2
    );

    expect(peaks).toEqual([
      { max: 0.5, min: -1 },
      { max: 1, min: -0.25 }
    ]);
  });

  it("steps through supported waveform zoom levels", () => {
    expect(nextWaveformZoom(1, "in")).toBe(2);
    expect(nextWaveformZoom(2, "in")).toBe(4);
    expect(nextWaveformZoom(16, "in")).toBe(16);
    expect(nextWaveformZoom(4, "out")).toBe(2);
    expect(nextWaveformZoom(1, "out")).toBe(1);
  });

  it("calculates visible waveform ranges from duration and zoom", () => {
    expect(getWaveformRange(120, 1, 30)).toEqual({ end: 120, start: 0 });
    expect(getWaveformRange(120, 4, 50)).toEqual({ end: 80, start: 50 });
    expect(getWaveformRange(120, 4, 100)).toEqual({ end: 120, start: 90 });
    expect(centerWaveformRange(60, 120, 4)).toBe(45);
  });

  it("keeps the current time visible inside a zoomed range", () => {
    expect(keepTimeInWaveformRange(20, 120, 4, 45)).toBeCloseTo(14.6);
    expect(keepTimeInWaveformRange(110, 120, 4, 45)).toBeCloseTo(85.4);
    expect(keepTimeInWaveformRange(60, 120, 4, 45)).toBe(45);
  });

  it("converts between visible percentages and times", () => {
    const range = { end: 70, start: 40 };

    expect(timeToWaveformPercent(55, range)).toBe(50);
    expect(timeToWaveformPercent(100, range)).toBe(100);
    expect(waveformPercentToTime(0.5, range, 120)).toBe(55);
  });
});
