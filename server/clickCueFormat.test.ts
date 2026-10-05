// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  CLICK_CUE_SAMPLE_RATE,
  getClickCueFrames,
  getClickCueRevisionInput,
  MAX_CLICK_CUE_DURATION_SECONDS
} from "./clickCueFormat.js";

describe("click cue format", () => {
  it("sorts sample-quantized cues and gives duplicate downbeats precedence", () => {
    const beats = [
      { time: 0.5, isDownbeat: false },
      { time: 0, isDownbeat: false },
      { time: 0.000001, isDownbeat: true },
      { time: 0, isDownbeat: false },
      { time: 0.25001, isDownbeat: true }
    ];
    expect(getClickCueFrames({ beats })).toEqual([[0, "downbeat"], [12_000, "downbeat"], [24_000, "normal"]]);
    expect(getClickCueRevisionInput({ beats })).toBe('[[0,"downbeat"],[12000,"downbeat"],[24000,"normal"]]');
    expect(getClickCueRevisionInput({ beats: [...beats].reverse() })).toBe(getClickCueRevisionInput({ beats }));
  });

  it("uses a deterministic empty revision and excludes the exact format end", () => {
    const maximum = MAX_CLICK_CUE_DURATION_SECONDS;
    expect(getClickCueRevisionInput(null)).toBe("[]");
    expect(getClickCueRevisionInput({ beats: [] })).toBe("[]");
    expect(getClickCueFrames({ beats: [
      { time: maximum - 1 / CLICK_CUE_SAMPLE_RATE, isDownbeat: true },
      { time: maximum, isDownbeat: false },
      { time: maximum + 10, isDownbeat: false },
      { time: Number.MAX_VALUE, isDownbeat: false }
    ] })).toEqual([[maximum * CLICK_CUE_SAMPLE_RATE - 1, "downbeat"]]);
  });

  it("rejects distinct overlapping pulses rather than dropping beat events", () => {
    for (const frame of [1, 47, 48]) {
      expect(() => getClickCueFrames({ beats: [
        { time: 0, isDownbeat: false },
        { time: frame / CLICK_CUE_SAMPLE_RATE, isDownbeat: true }
      ] })).toThrow("more than 1 ms");
    }
    expect(getClickCueFrames({ beats: [
      { time: 0, isDownbeat: false },
      { time: 49 / CLICK_CUE_SAMPLE_RATE, isDownbeat: false }
    ] })).toEqual([[0, "normal"], [49, "normal"]]);
  });

  it.each([NaN, Infinity, -Infinity, -0.001])("rejects invalid beat time %s", (time) => {
    expect(() => getClickCueFrames({ beats: [{ time, isDownbeat: false }] })).toThrow("finite and nonnegative");
  });
});
