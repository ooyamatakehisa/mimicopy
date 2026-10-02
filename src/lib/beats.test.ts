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

  it.each(["madmom", "beat-this"])("requires a valid %s grid when analysis is completed", (source) => {
    const beatGrid = {
      analyzedAt: timestamp,
      beats: [{ isDownbeat: true, position: 1, time: 0.5 }],
      beatsPerBar: [4],
      downbeats: [0.5],
      ...(source === "madmom"
        ? { source: "madmom" as const }
        : { source: "beat-this" as const, model: "final0" as const, postprocessor: "dbn" as const })
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


it("accepts Beat This! without a known meter and preserves unaccented beats", () => {
  const beatGrid = {
    analyzedAt: timestamp,
    beats: [{ time: 0.5, position: 2, isDownbeat: false }],
    beatsPerBar: [],
    downbeats: [],
    source: "beat-this",
    model: "final0",
    postprocessor: "dbn"
  };
  expect(parseTrackBeatAnalysisResponse({
    beatGrid, createdAt: timestamp, updatedAt: timestamp, error: null, status: "completed"
  }).beatGrid).toEqual(beatGrid);
});
