import { describe, expect, it } from "vitest";
import {
  clampTransposeSemitones,
  formatTransposeSemitones,
  stepTransposeSemitones
} from "./transpose";

describe("transpose", () => {
  it("steps in semitones and clamps the supported range", () => {
    expect(stepTransposeSemitones(0, "up")).toBe(1);
    expect(stepTransposeSemitones(0, "down")).toBe(-1);
    expect(stepTransposeSemitones(6, "up")).toBe(6);
    expect(stepTransposeSemitones(-6, "down")).toBe(-6);
  });

  it("normalizes arbitrary values to whole semitones", () => {
    expect(clampTransposeSemitones(2.6)).toBe(3);
    expect(clampTransposeSemitones(20)).toBe(6);
    expect(clampTransposeSemitones(Number.NaN)).toBe(0);
  });

  it("formats positive values with an explicit sign", () => {
    expect(formatTransposeSemitones(2)).toBe("+2");
    expect(formatTransposeSemitones(0)).toBe("0");
    expect(formatTransposeSemitones(-2)).toBe("-2");
  });
});
