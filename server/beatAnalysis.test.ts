// @vitest-environment node

import { describe, expect, it } from "vitest";
import { parseMadmomBeatGrid } from "./beatAnalysis.js";

describe("parseMadmomBeatGrid", () => {
  it("normalizes madmom beat positions and derives downbeats", () => {
    const beatGrid = parseMadmomBeatGrid({
      beats: [
        { isDownbeat: false, position: 2, time: 1.2 },
        { isDownbeat: true, position: 1, time: 0.5 },
        { position: 3, time: 1.9 }
      ],
      beatsPerBar: [4]
    });

    expect(beatGrid).toMatchObject({
      beats: [
        { isDownbeat: true, position: 1, time: 0.5 },
        { isDownbeat: false, position: 2, time: 1.2 },
        { isDownbeat: false, position: 3, time: 1.9 }
      ],
      beatsPerBar: [4],
      downbeats: [0.5],
      source: "madmom"
    });
    expect(beatGrid.analyzedAt).toEqual(expect.any(String));
  });

  it("rejects invalid madmom output", () => {
    expect(() =>
      parseMadmomBeatGrid({
        beats: [{ position: 1, time: Number.NaN }]
      })
    ).toThrow("madmom returned an invalid beat position.");
  });
});
