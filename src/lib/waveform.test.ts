import { describe, expect, it } from "vitest";
import {
  aggregateVisibleWaveformPeaks,
  buildWaveformPeaks,
  centerWaveformRange,
  formatWaveformZoom,
  getWaveformRange,
  keepTimeInWaveformRange,
  nextWaveformZoom,
  scaleWaveformZoom,
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

  it("aggregates dense peaks into the available full-range columns", () => {
    const peaks = [
      { max: 1, min: -1 },
      { max: 0.8, min: -0.8 },
      { max: 0, min: 0 },
      { max: 0, min: 0 }
    ];

    expect(
      aggregateVisibleWaveformPeaks({
        columnCount: 2,
        duration: 4,
        peaks,
        range: { end: 4, start: 0 }
      })
    ).toEqual([
      { max: 1, min: -1 },
      { max: 0, min: 0 }
    ]);
  });

  it("aggregates only the peaks inside a zoomed visible range", () => {
    const peaks = [
      { max: 0, min: 0 },
      { max: 0.3, min: -0.3 },
      { max: 1, min: -1 },
      { max: 0, min: 0 }
    ];

    expect(
      aggregateVisibleWaveformPeaks({
        columnCount: 2,
        duration: 4,
        peaks,
        range: { end: 4, start: 2 }
      })
    ).toEqual([
      { max: 1, min: -1 },
      { max: 0, min: 0 }
    ]);
  });

  it("steps through supported waveform zoom levels", () => {
    expect(nextWaveformZoom(1, "in")).toBe(2);
    expect(nextWaveformZoom(2, "in")).toBe(4);
    expect(nextWaveformZoom(8, "in")).toBe(12);
    expect(nextWaveformZoom(16, "in")).toBe(20);
    expect(nextWaveformZoom(28, "in")).toBe(32);
    expect(nextWaveformZoom(32, "in")).toBe(32);
    expect(nextWaveformZoom(24, "out")).toBe(20);
    expect(nextWaveformZoom(4, "out")).toBe(2);
    expect(nextWaveformZoom(1, "out")).toBe(1);
    expect(nextWaveformZoom(1.25, "in")).toBe(2);
    expect(nextWaveformZoom(1.25, "out")).toBe(1);
  });

  it("scales and formats continuous waveform zoom values", () => {
    expect(scaleWaveformZoom(2, 1.1)).toBeCloseTo(2.2);
    expect(scaleWaveformZoom(24, 2)).toBe(32);
    expect(scaleWaveformZoom(1.1, 0.5)).toBe(1);
    expect(formatWaveformZoom(2.234)).toBe("2.23x");
    expect(formatWaveformZoom(32)).toBe("32x");
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
