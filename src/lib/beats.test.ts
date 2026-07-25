import { describe, expect, it } from "vitest";
import { parseTrackBeatAnalysisResponse } from "./beats";

const timestamp = "2026-07-25T00:00:00.000Z";

describe("parseTrackBeatAnalysisResponse", () => {
  it("parses background analysis progress without a beat grid", () => {
    expect(
      parseTrackBeatAnalysisResponse({
        beatGrid: null,
        createdAt: timestamp,
        error: null,
        status: "running",
        updatedAt: timestamp
      })
    ).toEqual({
      beatGrid: null,
      createdAt: timestamp,
      error: null,
      status: "running",
      updatedAt: timestamp
    });
  });

  it("requires a valid beat grid when analysis is completed", () => {
    const beatGrid = {
      analyzedAt: timestamp,
      beats: [{ isDownbeat: true, position: 1, time: 0.5 }],
      beatsPerBar: [4],
      downbeats: [0.5],
      source: "madmom"
    };

    expect(
      parseTrackBeatAnalysisResponse({
        beatGrid,
        createdAt: timestamp,
        error: null,
        status: "completed",
        updatedAt: timestamp
      })
    ).toMatchObject({ beatGrid, status: "completed" });
    expect(() =>
      parseTrackBeatAnalysisResponse({
        beatGrid: null,
        createdAt: timestamp,
        error: null,
        status: "completed",
        updatedAt: timestamp
      })
    ).toThrow("拍解析結果の形式が壊れています。");
  });
});
