// @vitest-environment node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseBeatThisBeatGrid,
  parseStoredBeatGrid,
  runBeatThisBeatAnalysis
} from "./beatAnalysis.js";

const output = {
  beats: [
    { isDownbeat: false, position: 2, time: 1.2 },
    { isDownbeat: true, position: 1, time: 0.5 },
    { isDownbeat: false, position: 3, time: 1.9 }
  ],
  beatsPerBar: [4],
  source: "beat-this",
  model: "final0",
  postprocessor: "dbn"
};

describe("Beat This! output", () => {
  it("sorts beat positions and derives accents from detected downbeats", () => {
    expect(parseBeatThisBeatGrid(output)).toMatchObject({
      beats: [output.beats[1], output.beats[0], output.beats[2]],
      beatsPerBar: [4],
      downbeats: [0.5],
      source: "beat-this",
      model: "final0",
      postprocessor: "dbn"
    });
  });

  it("accepts silence and unknown meter without inventing 3/4 or 4/4", () => {
    expect(parseBeatThisBeatGrid({ beats: [], beatsPerBar: [], source: "beat-this", model: "final0", postprocessor: "dbn" }))
      .toMatchObject({ beats: [], beatsPerBar: [], downbeats: [] });
  });

  it("rejects invalid timestamps, meter and unexpected tracker output", () => {
    expect(() => parseBeatThisBeatGrid({ ...output, beats: [{ position: 1, time: Number.NaN }] }))
      .toThrow("Beat This! returned an invalid beat position.");
    expect(() => parseBeatThisBeatGrid({ ...output, beatsPerBar: [0] }))
      .toThrow("Beat This! returned invalid measure lengths.");
    expect(() => parseBeatThisBeatGrid({ ...output, source: "madmom" }))
      .toThrow("Beat This! returned an invalid beat grid.");
  });

  it.each(["madmom", "beat-this"])("preserves stored %s provenance", (source) => {
    const stored = { ...output, source, analyzedAt: "2026-10-02T00:00:00.000Z" };
    expect(parseStoredBeatGrid(stored)).toMatchObject({ source, analyzedAt: stored.analyzedAt });
  });

  it("reloads a Beat This! grid without a complete measure", () => {
    const grid = parseBeatThisBeatGrid({ ...output, beatsPerBar: [] });
    expect(parseStoredBeatGrid(grid)).toEqual(grid);
    expect(() => parseStoredBeatGrid({ ...grid, source: "madmom" })).toThrow();
  });
});

describe("analysis subprocess", () => {
  const directories: string[] = [];
  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  async function script(source: string) {
    const directory = await mkdtemp(path.join(tmpdir(), "mimicopy-beat-test-"));
    directories.push(directory);
    const scriptPath = path.join(directory, "tracker.cjs");
    await writeFile(scriptPath, source);
    return { pythonPath: process.execPath, scriptPath };
  }

  it("passes filenames literally and parses the JSON protocol", async () => {
    const audioPath = '/tmp/music with spaces; $(nothing).mp3';
    const options = await script(`
      if (process.argv[2] !== ${JSON.stringify(audioPath)}) process.exit(1);
      console.error('progress');
      console.log(${JSON.stringify(JSON.stringify(output))});
    `);
    await expect(runBeatThisBeatAnalysis(audioPath, options)).resolves.toMatchObject({ source: "beat-this", model: "final0", postprocessor: "dbn" });
  });

  it("reports dependency/inference errors", async () => {
    const options = await script("console.error('model unavailable'); process.exit(1);");
    await expect(runBeatThisBeatAnalysis("audio.mp3", options)).rejects.toThrow("model unavailable");
  });

  it("rejects corrupted stdout", async () => {
    const options = await script("console.log('not JSON');");
    await expect(runBeatThisBeatAnalysis("audio.mp3", options)).rejects.toThrow("Beat This! returned invalid JSON.");
  });

  it("terminates inference at the configured timeout", async () => {
    const options = await script("setInterval(() => {}, 1000);");
    await expect(runBeatThisBeatAnalysis("audio.mp3", { ...options, timeoutMs: 100 }))
      .rejects.toThrow("Beat This! beat analysis timed out.");
  });
});
