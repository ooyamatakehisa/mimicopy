// @vitest-environment node

import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./index.js";
import { createLibraryStore, type LibraryStore } from "./libraryStore.js";
import {
  createMixerMediaService,
  generateMixerMedia,
  MAX_MIXER_DURATION_SECONDS,
  type MixerMediaInput
} from "./mixerMedia.js";

const directories: string[] = [];
const stores: LibraryStore[] = [];

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), "mimicopy-mixer-"));
  directories.push(directory);
  return directory;
}

function pcmWav(values: number[], frames: number, sampleRate = 48_000) {
  const blockAlign = values.length * 2;
  const bytes = Buffer.alloc(44 + frames * blockAlign);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(values.length, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * blockAlign, 28);
  bytes.writeUInt16LE(blockAlign, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(frames * blockAlign, 40);
  for (let frame = 0; frame < frames; frame += 1) {
    values.forEach((value, channel) => bytes.writeInt16LE(value, 44 + frame * blockAlign + channel * 2));
  }
  return bytes;
}

function readPcm(bytes: Buffer) {
  let channelCount = 0;
  let sampleRate = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const length = bytes.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    const kind = bytes.toString("ascii", offset, offset + 4);
    if (kind === "fmt ") {
      channelCount = bytes.readUInt16LE(dataOffset + 2);
      sampleRate = bytes.readUInt32LE(dataOffset + 4);
    }
    if (kind === "data") {
      return {
        channelCount,
        sampleRate,
        frames: length / (2 * channelCount),
        frame: (index: number) => Array.from({ length: channelCount }, (_, channel) =>
          bytes.readInt16LE(dataOffset + (index * channelCount + channel) * 2))
      };
    }
    offset = dataOffset + length + length % 2;
  }
  throw new Error("Missing PCM data in test output.");
}

async function fixtureInputs(directory: string): Promise<MixerMediaInput> {
  const input = {
    originalPath: path.join(directory, "original.wav"),
    stemPath: path.join(directory, "stem.wav"),
    remainderPath: path.join(directory, "remainder.wav"),
    outputPath: path.join(directory, "mixers", "output.wav")
  };
  await Promise.all([
    writeFile(input.originalPath, pcmWav([1000, 2000], 4800)),
    writeFile(input.stemPath, pcmWav([3000, 4000], 2400)),
    writeFile(input.remainderPath, pcmWav([5000, 6000], 7200))
  ]);
  return input;
}

async function libraryFixture() {
  const storageDir = await temporaryDirectory();
  const store = createLibraryStore({
    databasePath: path.join(storageDir, "library.sqlite"),
    mediaDir: path.join(storageDir, "media")
  });
  stores.push(store);
  const input = await fixtureInputs(store.mediaDir);
  const track = store.createTrack({
    title: "Mixer fixture", sourceType: "upload",
    mediaFilename: path.basename(input.originalPath), duration: 0.1
  });
  store.createSeparation({
    mediaFilename: path.basename(input.stemPath),
    remainderMediaFilename: path.basename(input.remainderPath),
    targetStem: "guitar", trackId: track.id
  });
  store.updateSeparationStatus({ trackId: track.id, status: "completed" });
  return { store, track, input, storageDir };
}

afterEach(async () => {
  stores.splice(0).forEach((store) => store.close());
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("synchronized mixer media", () => {
  it("uses real ffmpeg to preserve six channel positions and original duration, padding a shorter stem", async () => {
    const input = await fixtureInputs(await temporaryDirectory());
    await generateMixerMedia(input);
    const pcm = readPcm(await readFile(input.outputPath));
    expect(pcm.channelCount).toBe(6);
    expect(pcm.sampleRate).toBe(48_000);
    expect(pcm.frames).toBe(4800);
    expect(pcm.frame(1000)).toEqual([1000, 2000, 3000, 4000, 5000, 6000]);
    expect(pcm.frame(3500)).toEqual([1000, 2000, 0, 0, 5000, 6000]);
    expect(pcm.frame(4799)).toEqual([1000, 2000, 0, 0, 5000, 6000]);
    expect(await readdir(path.dirname(input.outputPath))).toEqual(["output.wav"]);
  });

  it("duplicates mono at unity in both channels while resampling each input", async () => {
    const input = await fixtureInputs(await temporaryDirectory());
    await Promise.all([
      writeFile(input.originalPath, pcmWav([2000], 1600, 16_000)),
      writeFile(input.stemPath, pcmWav([4000], 4410, 44_100)),
      writeFile(input.remainderPath, pcmWav([6000], 2400, 24_000))
    ]);
    await generateMixerMedia(input);
    const pcm = readPcm(await readFile(input.outputPath));
    expect(pcm.frames).toBe(4800);
    pcm.frame(1000).forEach((sample, channel) => {
      expect(Math.abs(sample - [2000, 2000, 4000, 4000, 6000, 6000][channel]!)).toBeLessThanOrEqual(1);
    });
  });

  it("cleans partial files on ffmpeg failure and leaves an existing output intact", async () => {
    const input = await fixtureInputs(await temporaryDirectory());
    await generateMixerMedia(input);
    const existing = await readFile(input.outputPath);
    await writeFile(input.stemPath, "invalid audio");
    await expect(generateMixerMedia(input)).rejects.toThrow();
    expect(await readFile(input.outputPath)).toEqual(existing);
    expect(await readdir(path.dirname(input.outputPath))).toEqual(["output.wav"]);
  });

  it("does not start generation or create output directories when already cancelled", async () => {
    const input = await fixtureInputs(await temporaryDirectory());
    const controller = new AbortController();
    controller.abort();
    await expect(generateMixerMedia(input, "missing-ffmpeg", controller.signal))
      .rejects.toMatchObject({ name: "AbortError" });
    await expect(readdir(path.dirname(input.outputPath))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("waits for an aborted child to close before removing its partial output", async () => {
    const directory = await temporaryDirectory();
    const input = await fixtureInputs(directory);
    const binary = path.join(directory, "delayed-ffmpeg.cjs");
    const startedPath = path.join(directory, "started");
    const closedPath = path.join(directory, "closed");
    await writeFile(binary, `#!/usr/bin/env node
const fs = require("node:fs");
const outputPath = process.argv.at(-1);
process.on("SIGTERM", () => {
  setTimeout(() => {
    fs.appendFileSync(outputPath, "final child write");
    fs.writeFileSync(${JSON.stringify(closedPath)}, "finished");
    process.exit(0);
  }, 150);
});
fs.writeFileSync(outputPath, "partial output");
fs.writeFileSync(${JSON.stringify(startedPath)}, "started");
setInterval(() => {}, 1000);
`);
    await chmod(binary, 0o755);
    const controller = new AbortController();
    const generation = generateMixerMedia(input, binary, controller.signal);
    const rejection = expect(generation).rejects.toMatchObject({ name: "AbortError" });
    try {
      // Child startup can exceed the default 1s under the full parallel suite;
      // this test constrains cleanup ordering, not process launch latency.
      await vi.waitFor(async () => expect(await readFile(startedPath, "utf8")).toBe("started"), { timeout: 5000 });
      controller.abort();
      await rejection;
      expect(await readFile(closedPath, "utf8")).toBe("finished");
      expect(await readdir(path.dirname(input.outputPath))).toEqual([]);
    } finally {
      controller.abort();
      await generation.catch(() => undefined);
    }
  }, 10_000);

  it("terminates an aborted child that ignores SIGTERM before completing cleanup", async () => {
    const directory = await temporaryDirectory();
    const input = await fixtureInputs(directory);
    const binary = path.join(directory, "unresponsive-ffmpeg.cjs");
    const pidPath = path.join(directory, "child-pid");
    await writeFile(binary, `#!/usr/bin/env node
const fs = require("node:fs");
process.on("SIGTERM", () => {});
fs.writeFileSync(process.argv.at(-1), "partial output");
fs.writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));
setInterval(() => {}, 1000);
`);
    await chmod(binary, 0o755);
    const controller = new AbortController();
    const generation = generateMixerMedia(input, binary, controller.signal);
    const rejection = expect(generation).rejects.toMatchObject({ name: "AbortError" });
    try {
      let childPid = 0;
      await vi.waitFor(async () => {
        childPid = Number(await readFile(pidPath, "utf8"));
        expect(childPid).toBeGreaterThan(0);
      }, { timeout: 5000 });
      controller.abort();
      await rejection;
      expect(() => process.kill(childPid, 0)).toThrow();
      expect(await readdir(path.dirname(input.outputPath))).toEqual([]);
    } finally {
      controller.abort();
      await generation.catch(() => undefined);
    }
  }, 10_000);

  it("escalates the generation deadline when a child ignores SIGTERM and removes its partial output", async () => {
    const directory = await temporaryDirectory();
    const input = await fixtureInputs(directory);
    const binary = path.join(directory, "timeout-ffmpeg.cjs");
    const pidPath = path.join(directory, "child-pid");
    await writeFile(binary, `#!/usr/bin/env node
const fs = require("node:fs");
process.on("SIGTERM", () => {});
fs.writeFileSync(process.argv.at(-1), "partial output");
fs.writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));
setInterval(() => {}, 1000);
`);
    await chmod(binary, 0o755);
    const deadline = new AbortController();
    const supplied = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(deadline.signal);
    const generation = generateMixerMedia(input, binary, supplied.signal);
    const result = generation.then(
      () => ({ status: "fulfilled" as const }),
      (error: unknown) => ({ status: "rejected" as const, error })
    );
    try {
      let childPid = 0;
      await vi.waitFor(async () => {
        childPid = Number(await readFile(pidPath, "utf8"));
        expect(childPid).toBeGreaterThan(0);
      }, { timeout: 5000 });
      expect(timeout).toHaveBeenCalledExactlyOnceWith(15 * 60 * 1000);
      const reason = new DOMException("Generation timed out", "TimeoutError");
      deadline.abort(reason);
      await expect(result).resolves.toMatchObject({
        status: "rejected", error: { name: "AbortError", cause: reason }
      });
      expect(supplied.signal.aborted).toBe(false);
      expect(() => process.kill(childPid, 0)).toThrow();
      expect(await readdir(path.dirname(input.outputPath))).toEqual([]);
    } finally {
      timeout.mockRestore();
      deadline.abort();
      await generation.catch(() => undefined);
    }
  }, 10_000);

  it("deduplicates in-flight generation and reuses a cache only while the source fingerprint matches", async () => {
    const { store, track, input } = await libraryFixture();
    const generate = vi.fn(generateMixerMedia);
    const mixer = createMixerMediaService({ store, generate });
    const first = mixer.get(track.id);
    expect(mixer.get(track.id)).toBe(first);
    const result = await first;
    expect(await mixer.get(track.id)).toEqual(result);
    expect(generate).toHaveBeenCalledTimes(1);
    await writeFile(input.stemPath, pcmWav([3000, 4000], 2600));
    const replacement = await mixer.get(track.id);
    expect(replacement.mediaUrl).not.toBe(result.mediaUrl);
    expect(generate).toHaveBeenCalledTimes(2);
    await rm(input.stemPath);
    await expect(mixer.get(track.id)).rejects.toMatchObject({ status: 404 });
  });

  it("validates missing tracks, incomplete separation, missing files, and oversized tracks before generation", async () => {
    const { store, track } = await libraryFixture();
    const generate = vi.fn(generateMixerMedia);
    const mixer = createMixerMediaService({ store, generate });
    await expect(mixer.get("missing")).rejects.toMatchObject({ status: 404 });
    store.updateSeparationStatus({ trackId: track.id, status: "running" });
    await expect(mixer.get(track.id)).rejects.toMatchObject({ status: 409 });
    store.updateSeparationStatus({ trackId: track.id, status: "completed" });
    store.updateTrackDuration(track.id, MAX_MIXER_DURATION_SECONDS + 1);
    await expect(mixer.get(track.id)).rejects.toMatchObject({ status: 413 });
    expect(generate).not.toHaveBeenCalled();
  });

  it("cleans derived output even when the track is deleted during generation", async () => {
    const { store, track } = await libraryFixture();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const generate = vi.fn(async (input: MixerMediaInput) => {
      await gate;
      await generateMixerMedia(input);
    });
    const mixer = createMixerMediaService({ store, generate });
    const pending = mixer.get(track.id);
    const rejection = expect(pending).rejects.toMatchObject({ status: 404 });
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    store.deleteTrack(track.id);
    const removal = mixer.remove(track.id);
    release();
    await rejection;
    await removal;
    expect(await readdir(path.join(store.mediaDir, "mixers"))).toEqual([]);
  });

  it("cancels deletion before asynchronous source preparation can start a generator", async () => {
    const { store, track } = await libraryFixture();
    const generate = vi.fn(generateMixerMedia);
    const mixer = createMixerMediaService({ store, generate });
    const pending = mixer.get(track.id);
    const rejection = expect(pending).rejects.toMatchObject({ status: 404, message: "Track was not found." });
    store.deleteTrack(track.id);
    await mixer.remove(track.id);
    await rejection;
    expect(generate).not.toHaveBeenCalled();
    await expect(readdir(path.join(store.mediaDir, "mixers"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("aborts deduplicated generation and waits for cleanup before removing derived files", async () => {
    const { store, track } = await libraryFixture();
    let releaseCleanup: () => void = () => undefined;
    const cleanupGate = new Promise<void>((resolve) => { releaseCleanup = resolve; });
    let cancelled = false;
    const generate = vi.fn(async (input: MixerMediaInput, signal?: AbortSignal) => {
      if (!signal) throw new Error("Missing generation cancellation signal.");
      await generateMixerMedia(input);
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => { cancelled = true; resolve(); }, { once: true });
        if (signal.aborted) { cancelled = true; resolve(); }
      });
      await cleanupGate;
      signal.throwIfAborted();
    });
    const mixer = createMixerMediaService({ store, generate });
    const pending = mixer.get(track.id);
    expect(mixer.get(track.id)).toBe(pending);
    const rejection = expect(pending).rejects.toMatchObject({ status: 404, message: "Track was not found." });
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    store.deleteTrack(track.id);
    let removed = false;
    const removal = mixer.remove(track.id).then(() => { removed = true; });
    await vi.waitFor(() => expect(cancelled).toBe(true));
    expect(removed).toBe(false);
    expect(await readdir(path.join(store.mediaDir, "mixers"))).toHaveLength(1);
    releaseCleanup();
    await Promise.all([rejection, removal]);
    expect(await readdir(path.join(store.mediaDir, "mixers"))).toEqual([]);
    await expect(mixer.get(track.id)).rejects.toMatchObject({ status: 404 });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("serves the generated WAV with byte ranges and removes it with the track", async () => {
    const { storageDir, track, store, input } = await libraryFixture();
    const server = createApp({ storageDir, analyzeBeats: async () => ({
      analyzedAt: new Date().toISOString(), beats: [], beatsPerBar: [4], downbeats: [], source: "madmom"
    }) }).listen(0);
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing server address.");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const response = await fetch(`${baseUrl}/api/tracks/${track.id}/mixer`);
      const body = await response.json() as { mediaUrl: string };
      expect(response.status).toBe(200);
      expect(body.mediaUrl).toMatch(/^\/media\/mixers\/[a-f0-9]+\/[a-f0-9]+\.wav$/);
      const range = await fetch(`${baseUrl}${body.mediaUrl}`, { headers: { Range: "bytes=0-63" } });
      expect(range.status).toBe(206);
      expect(range.headers.get("content-type")).toContain("audio/wav");
      expect((await range.arrayBuffer()).byteLength).toBe(64);
      const missing = await fetch(`${baseUrl}/api/tracks/missing/mixer`);
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({ error: "Track was not found." });
      store.updateSeparationStatus({ trackId: track.id, status: "running" });
      const incomplete = await fetch(`${baseUrl}/api/tracks/${track.id}/mixer`);
      expect(incomplete.status).toBe(409);
      expect(await incomplete.json()).toEqual({ error: "Both separated sources must be ready before mixing." });
      store.updateSeparationStatus({ trackId: track.id, status: "completed" });
      await writeFile(input.stemPath, "invalid audio");
      const failure = await fetch(`${baseUrl}/api/tracks/${track.id}/mixer`);
      expect(failure.status).toBe(500);
      expect(await failure.json()).toEqual({ error: expect.stringContaining("Could not prepare synchronized audio.") });
      const deletion = await fetch(`${baseUrl}/api/tracks/${track.id}`, { method: "DELETE" });
      expect(deletion.status).toBe(200);
      expect(await readdir(path.join(store.mediaDir, "mixers"))).toEqual([]);
      expect((await fetch(`${baseUrl}${body.mediaUrl}`)).status).toBe(404);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
