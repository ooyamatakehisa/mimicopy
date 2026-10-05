// @vitest-environment node

import { chmod, mkdir, mkdtemp, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./index.js";
import { createLibraryStore, type LibraryStore } from "./libraryStore.js";
import {
  createMixerMediaService,
  generateMixerMedia,
  mixerMediaArguments,
  MAX_MIXER_DURATION_SECONDS,
  validateMixerWav,
  type MixerMediaInput
} from "./mixerMedia.js";
import { CLICK_CUE_PCM16, getClickCueRevisionInput, type ClickCueBeatGrid } from "./clickCueFormat.js";
import { writeClickCueWav } from "./clickCueMedia.js";
import type { BeatGrid } from "./beatAnalysis.js";

const directories: string[] = [];
const stores: LibraryStore[] = [];

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), "mimicopy-mixer-"));
  directories.push(directory);
  return directory;
}

function cueRevision(grid: ClickCueBeatGrid | null) {
  return createHash("sha256").update(getClickCueRevisionInput(grid)).digest("hex");
}

function beatGrid(time: number, downbeat = false): BeatGrid {
  return { analyzedAt: new Date().toISOString(), source: "beat-this", model: "final0", postprocessor: "dbn",
    beats: [{ time, position: downbeat ? 1 : 2, isDownbeat: downbeat }], beatsPerBar: [], downbeats: downbeat ? [time] : [] };
}

async function readGeneratedPcm(filePath: string) {
  const metadata = await validateMixerWav(filePath);
  const binary: unknown = createRequire(import.meta.url)("ffmpeg-static");
  if (typeof binary !== "string") throw new Error("Missing ffmpeg.");
  const { stdout } = await promisify(execFile)(binary, [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-i", filePath, "-c:a", "pcm_s16le", "-f", "s16le", "-"
  ], { encoding: "buffer", maxBuffer: 4 * 1024 * 1024 });
  expect(stdout.length).toBe(metadata.frames * metadata.channels * 2);
  return { channelCount: metadata.channels, sampleRate: metadata.sampleRate, frames: metadata.frames,
    frame: (index: number) => Array.from({ length: metadata.channels }, (_, channel) =>
      stdout.readInt16LE((index * metadata.channels + channel) * 2)) };
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

async function fixtureInputs(directory: string): Promise<Extract<MixerMediaInput, { stemPath: string }>> {
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
  it("uses real ffmpeg to preserve all eight positions and original duration, padding a shorter stem", async () => {
    const input = await fixtureInputs(await temporaryDirectory());
    input.cues = [[0, "downbeat"], [1920, "normal"], [4795, "downbeat"]];
    await generateMixerMedia(input);
    const pcm = await readGeneratedPcm(input.outputPath);
    expect(pcm.channelCount).toBe(8);
    expect(pcm.sampleRate).toBe(48_000);
    expect(pcm.frames).toBe(4800);
    expect(pcm.frame(0)).toEqual([1000, 2000, 3000, 4000, 5000, 6000, 0, CLICK_CUE_PCM16]);
    expect(pcm.frame(47).slice(6)).toEqual([0, CLICK_CUE_PCM16]);
    expect(pcm.frame(48).slice(6)).toEqual([0, 0]);
    expect(pcm.frame(1000)).toEqual([1000, 2000, 3000, 4000, 5000, 6000, 0, 0]);
    expect(pcm.frame(1920).slice(6)).toEqual([CLICK_CUE_PCM16, 0]);
    expect(pcm.frame(1967).slice(6)).toEqual([CLICK_CUE_PCM16, 0]);
    expect(pcm.frame(1968).slice(6)).toEqual([0, 0]);
    expect(pcm.frame(3500)).toEqual([1000, 2000, 0, 0, 5000, 6000, 0, 0]);
    expect(pcm.frame(4799)).toEqual([1000, 2000, 0, 0, 5000, 6000, 0, CLICK_CUE_PCM16]);
    expect((await validateMixerWav(input.outputPath)).container).toBe("RIFF");
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
    const pcm = await readGeneratedPcm(input.outputPath);
    expect(pcm.frames).toBe(4800);
    pcm.frame(1000).forEach((sample, channel) => {
      expect(Math.abs(sample - [2000, 2000, 4000, 4000, 6000, 6000, 0, 0][channel]!)).toBeLessThanOrEqual(1);
    });
  });

  it("muxes original-only cues without extending the decoded original to a later beat", async () => {
    const input = await fixtureInputs(await temporaryDirectory());
    await generateMixerMedia({ mode: "original", originalPath: input.originalPath, outputPath: input.outputPath,
      cues: [[240, "normal"], [48_000, "downbeat"]] });
    const pcm = await readGeneratedPcm(input.outputPath);
    expect(pcm.frames).toBe(4800);
    expect(pcm.frame(240)).toEqual([1000, 2000, 0, 0, 0, 0, CLICK_CUE_PCM16, 0]);
    expect(pcm.frame(288)).toEqual([1000, 2000, 0, 0, 0, 0, 0, 0]);
    expect(pcm.frame(4799)).toEqual([1000, 2000, 0, 0, 0, 0, 0, 0]);
  });

  it("writes bounded sparse cue WAVs, including a clipped pulse at the two-hour limit", async () => {
    const directory = await temporaryDirectory();
    const small = path.join(directory, "small.wav");
    await writeClickCueWav(small, [[0, "normal"], [480, "downbeat"]]);
    const pcm = readPcm(await readFile(small));
    expect(pcm.channelCount).toBe(2);
    expect(pcm.frames).toBe(528);
    expect(pcm.frame(47)).toEqual([CLICK_CUE_PCM16, 0]);
    expect(pcm.frame(48)).toEqual([0, 0]);
    expect(pcm.frame(479)).toEqual([0, 0]);
    expect(pcm.frame(480)).toEqual([0, CLICK_CUE_PCM16]);

    const maximum = MAX_MIXER_DURATION_SECONDS * 48_000;
    const large = path.join(directory, "last-frame.wav");
    await writeClickCueWav(large, [[maximum - 1, "downbeat"]]);
    expect((await stat(large)).size).toBe(44 + maximum * 4);
    const file = await open(large, "r");
    try {
      const bytes = Buffer.alloc(8);
      await file.read(bytes, 0, 8, 44 + (maximum - 2) * 4);
      expect([...Array(4)].map((_, index) => bytes.readInt16LE(index * 2)))
        .toEqual([0, 0, 0, CLICK_CUE_PCM16]);
    } finally {
      await file.close();
    }
  });

  it("validates real ffmpeg RF64 output with the same eight channel positions", async () => {
    const input = await fixtureInputs(await temporaryDirectory());
    const cuePath = path.join(path.dirname(input.originalPath), "cues.wav");
    input.cues = [[0, "downbeat"], [1920, "normal"]];
    await writeClickCueWav(cuePath, input.cues);
    // A small forced-RF64 file exercises the actual muxer's ds64/fmt layout.
    // Production uses auto, reserving RF64 for outputs beyond the RIFF limit.
    const args = mixerMediaArguments(input, cuePath);
    expect(args[args.indexOf("-rf64") + 1]).toBe("auto");
    args[args.indexOf("-rf64") + 1] = "always";
    const binary: unknown = createRequire(import.meta.url)("ffmpeg-static");
    if (typeof binary !== "string") throw new Error("Missing ffmpeg.");
    // The helper normally creates this directory before running ffmpeg.
    await mkdir(path.dirname(input.outputPath), { recursive: true });
    await promisify(execFile)(binary, args);
    expect(await validateMixerWav(input.outputPath)).toMatchObject({ container: "RF64", frames: 4800 });
    const pcm = await readGeneratedPcm(input.outputPath);
    expect(pcm.frame(0)).toEqual([1000, 2000, 3000, 4000, 5000, 6000, 0, CLICK_CUE_PCM16]);
    expect(pcm.frame(1920)).toEqual([1000, 2000, 3000, 4000, 5000, 6000, CLICK_CUE_PCM16, 0]);
  });

  it("validates RIFF/RF64 sizes and two-hour limits using sparse PCM beyond four GiB", async () => {
    const directory = await temporaryDirectory();
    const filePath = path.join(directory, "metadata.wav");
    const header = (frames: number, rf64 = true) => {
      const bytes = Buffer.alloc(rf64 ? 80 : 44);
      const dataBytes = frames * 16;
      bytes.write(rf64 ? "RF64" : "RIFF", 0);
      bytes.writeUInt32LE(rf64 ? 0xffffffff : bytes.length + dataBytes - 8, 4);
      bytes.write("WAVE", 8);
      if (rf64) {
        bytes.write("ds64", 12); bytes.writeUInt32LE(28, 16);
        bytes.writeBigUInt64LE(BigInt(bytes.length + dataBytes - 8), 20);
        bytes.writeBigUInt64LE(BigInt(dataBytes), 28);
        bytes.writeBigUInt64LE(BigInt(frames), 36);
      }
      const fmt = rf64 ? 48 : 12;
      bytes.write("fmt ", fmt); bytes.writeUInt32LE(16, fmt + 4);
      bytes.writeUInt16LE(1, fmt + 8); bytes.writeUInt16LE(8, fmt + 10);
      bytes.writeUInt32LE(48_000, fmt + 12); bytes.writeUInt32LE(768_000, fmt + 16);
      bytes.writeUInt16LE(16, fmt + 20); bytes.writeUInt16LE(16, fmt + 22);
      bytes.write("data", fmt + 24); bytes.writeUInt32LE(rf64 ? 0xffffffff : dataBytes, fmt + 28);
      return bytes;
    };
    const save = async (bytes: Buffer, frames: number) => {
      const file = await open(filePath, "w");
      try {
        await file.truncate(bytes.length + frames * 16);
        await file.write(bytes, 0, bytes.length, 0);
      } finally { await file.close(); }
    };
    await save(header(100, false), 100);
    await expect(validateMixerWav(filePath)).resolves.toMatchObject({ container: "RIFF", frames: 100 });
    const largestRiffFrames = Math.floor((0xffffffff - 36) / 16);
    await save(header(largestRiffFrames, false), largestRiffFrames);
    await expect(validateMixerWav(filePath)).resolves.toMatchObject({ container: "RIFF", frames: largestRiffFrames });
    const maximum = MAX_MIXER_DURATION_SECONDS * 48_000;
    await save(header(maximum), maximum);
    expect((await stat(filePath)).size).toBe(80 + 5_529_600_000);
    await expect(validateMixerWav(filePath)).resolves.toMatchObject({ container: "RF64", frames: maximum });
    // Read/write at an actual >4 GiB offset without allocating the PCM payload.
    const large = await open(filePath, "r+");
    try {
      const tail = Buffer.alloc(16); tail.writeInt16LE(1234, 14);
      await large.write(tail, 0, 16, 80 + (maximum - 1) * 16);
      const observed = Buffer.alloc(16);
      await large.read(observed, 0, 16, 80 + (maximum - 1) * 16);
      expect(observed).toEqual(tail);
    } finally { await large.close(); }
    await save(header(maximum + 1), maximum + 1);
    await expect(validateMixerWav(filePath)).rejects.toMatchObject({ status: 413 });
    const invalid = [
      (bytes: Buffer) => bytes.write("JUNK", 12),
      (bytes: Buffer) => bytes.writeUInt32LE(27, 16),
      (bytes: Buffer) => bytes.writeBigUInt64LE(1n, 20),
      (bytes: Buffer) => bytes.writeBigUInt64LE(1601n, 28),
      (bytes: Buffer) => bytes.writeBigUInt64LE(99n, 36),
      (bytes: Buffer) => bytes.writeUInt32LE(1, 44),
      (bytes: Buffer) => bytes.writeUInt16LE(3, 56),
      (bytes: Buffer) => bytes.writeUInt16LE(6, 58),
      (bytes: Buffer) => bytes.writeUInt32LE(44_100, 60),
      (bytes: Buffer) => bytes.writeUInt32LE(1, 64),
      (bytes: Buffer) => bytes.writeUInt16LE(12, 68),
      (bytes: Buffer) => bytes.writeUInt16LE(24, 70),
      (bytes: Buffer) => bytes.writeUInt32LE(1600, 76)
    ];
    for (const mutate of invalid) {
      const bytes = header(100); mutate(bytes);
      await save(bytes, 100);
      await expect(validateMixerWav(filePath)).rejects.toThrow("PCM WAV metadata");
    }
    await save(header(0), 0);
    await expect(validateMixerWav(filePath)).rejects.toThrow("PCM WAV metadata");
    await writeFile(filePath, header(100));
    await expect(validateMixerWav(filePath)).rejects.toThrow("PCM WAV metadata");
    const truncated = header(100, false); truncated.writeUInt32LE(1, 40);
    await save(truncated, 100);
    await expect(validateMixerWav(filePath)).rejects.toThrow("PCM WAV metadata");
  });

  it("checks extensible PCM format and bounds chunk traversal without accepting ambiguous data", async () => {
    const filePath = path.join(await temporaryDirectory(), "chunks.wav");
    const chunk = (kind: string, payload: Buffer) => {
      const bytes = Buffer.alloc(8 + payload.length + payload.length % 2);
      bytes.write(kind, 0); bytes.writeUInt32LE(payload.length, 4); payload.copy(bytes, 8);
      return bytes;
    };
    const format = Buffer.alloc(40);
    format.writeUInt16LE(0xfffe, 0); format.writeUInt16LE(8, 2);
    format.writeUInt32LE(48_000, 4); format.writeUInt32LE(768_000, 8);
    format.writeUInt16LE(16, 12); format.writeUInt16LE(16, 14);
    format.writeUInt16LE(22, 16); format.writeUInt16LE(16, 18);
    format.writeUInt32LE(0x63f, 20);
    Buffer.from("0100000000001000800000aa00389b71", "hex").copy(format, 24);
    const save = async (chunks: Buffer[]) => {
      const payload = Buffer.concat(chunks);
      const root = Buffer.alloc(12);
      root.write("RIFF", 0); root.writeUInt32LE(payload.length + 4, 4); root.write("WAVE", 8);
      await writeFile(filePath, Buffer.concat([root, payload]));
    };
    const data = chunk("data", Buffer.alloc(16));
    // Odd-sized metadata includes its RIFF alignment byte and can be skipped.
    await save([chunk("JUNK", Buffer.alloc(1)), chunk("fmt ", format), data]);
    await expect(validateMixerWav(filePath)).resolves.toMatchObject({ frames: 1 });
    for (const offset of [16, 18, 20, 24]) {
      const invalid = Buffer.from(format); invalid[offset] ^= 1;
      await save([chunk("fmt ", invalid), data]);
      await expect(validateMixerWav(filePath)).rejects.toThrow("PCM WAV metadata");
    }
    for (const chunks of [
      [data, chunk("fmt ", format)],
      [chunk("fmt ", format), chunk("fmt ", format), data],
      [chunk("fmt ", format), data, data],
      [...Array.from({ length: 65 }, () => chunk("JUNK", Buffer.alloc(0))), chunk("fmt ", format), data],
      [chunk("JUNK", Buffer.alloc(1024 * 1024 + 1)), chunk("fmt ", format), data]
    ]) {
      await save(chunks);
      await expect(validateMixerWav(filePath)).rejects.toThrow("PCM WAV metadata");
    }
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

  it("uses cue content for cache identity, including accent changes and cleared analyses", async () => {
    const { store, track } = await libraryFixture();
    const generate = vi.fn(generateMixerMedia);
    const mixer = createMixerMediaService({ store, generate });
    store.queueBeatAnalysis(track.id);
    const initialGrid = beatGrid(0.02);
    store.completeBeatAnalysis(track.id, initialGrid);
    const first = await mixer.get(track.id);
    expect(first.cueRevision).toBe(cueRevision(initialGrid));
    store.completeBeatAnalysis(track.id, { ...initialGrid, analyzedAt: "2030-01-01T00:00:00Z" });
    expect(await mixer.get(track.id)).toEqual(first);
    expect(generate).toHaveBeenCalledTimes(1);
    const accented = beatGrid(0.02, true);
    store.completeBeatAnalysis(track.id, accented);
    const second = await mixer.get(track.id);
    expect(second.cueRevision).toBe(cueRevision(accented));
    expect(second.mediaUrl).not.toBe(first.mediaUrl);
    store.queueBeatAnalysis(track.id);
    const cleared = await mixer.get(track.id);
    expect(cleared.cueRevision).toBe(cueRevision(null));
    expect(cleared.mediaUrl).not.toBe(second.mediaUrl);
  });

  it("supports a completed beat grid before separation and uses the actual decoded original length", async () => {
    const { store, track } = await libraryFixture();
    store.updateSeparationStatus({ trackId: track.id, status: "running" });
    store.updateTrackDuration(track.id, 0.01);
    store.queueBeatAnalysis(track.id);
    const grid = beatGrid(0.05, true);
    store.completeBeatAnalysis(track.id, grid);
    const generate = vi.fn(generateMixerMedia);
    const mixer = createMixerMediaService({ store, generate });
    const result = await mixer.get(track.id);
    expect(generate.mock.calls[0][0]).toMatchObject({ mode: "original" });
    expect(generate.mock.calls[0][0]).not.toHaveProperty("stemPath");
    const pcm = await readGeneratedPcm(path.join(store.mediaDir, result.mediaUrl.slice("/media/".length)));
    expect(pcm.frames).toBe(4800);
    expect(pcm.frame(2400)).toEqual([1000, 2000, 0, 0, 0, 0, 0, CLICK_CUE_PCM16]);
    store.updateSeparationStatus({ trackId: track.id, status: "completed" });
    const separated = await mixer.get(track.id);
    expect(separated.mediaUrl).not.toBe(result.mediaUrl);
    expect(separated.cueRevision).toBe(result.cueRevision);
  });

  it("reports a missing completed stem instead of silently using original-only mode", async () => {
    const { store, track, input } = await libraryFixture();
    store.queueBeatAnalysis(track.id);
    store.completeBeatAnalysis(track.id, beatGrid(0.05));
    await rm(input.remainderPath);
    const generate = vi.fn(generateMixerMedia);
    await expect(createMixerMediaService({ store, generate }).get(track.id)).rejects.toMatchObject({ status: 404 });
    expect(generate).not.toHaveBeenCalled();
  });

  it("follows a reanalysis during generation for every deduplicated caller", async () => {
    const { store, track } = await libraryFixture();
    store.queueBeatAnalysis(track.id);
    store.completeBeatAnalysis(track.id, beatGrid(0.01));
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let count = 0;
    const generate = vi.fn(async (input: MixerMediaInput, signal?: AbortSignal) => {
      if (++count === 1) await gate;
      await generateMixerMedia(input, signal);
    });
    const mixer = createMixerMediaService({ store, generate });
    const first = mixer.get(track.id);
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    const latestGrid = beatGrid(0.075, true);
    store.queueBeatAnalysis(track.id);
    store.completeBeatAnalysis(track.id, latestGrid);
    expect(mixer.get(track.id)).toBe(first);
    release();
    const result = await first;
    expect(result.cueRevision).toBe(cueRevision(latestGrid));
    expect(generate).toHaveBeenCalledTimes(2);
    const outputPath = path.join(store.mediaDir, result.mediaUrl.slice("/media/".length));
    const pcm = await readGeneratedPcm(outputPath);
    expect(pcm.frame(480).slice(6)).toEqual([0, 0]);
    expect(pcm.frame(3600).slice(6)).toEqual([0, CLICK_CUE_PCM16]);
    expect(await readdir(path.dirname(outputPath))).toEqual([path.basename(outputPath)]);
  });

  it("bounds regeneration when beat grids keep changing", async () => {
    const { store, track } = await libraryFixture();
    store.queueBeatAnalysis(track.id);
    store.completeBeatAnalysis(track.id, beatGrid(0.01));
    let count = 0;
    const generate = vi.fn(async (input: MixerMediaInput, signal?: AbortSignal) => {
      await generateMixerMedia(input, signal);
      store.completeBeatAnalysis(track.id, beatGrid(0.02 + count++ * 0.01));
    });
    const mixer = createMixerMediaService({ store, generate });
    await expect(mixer.get(track.id)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("repeatedly") });
    expect(generate).toHaveBeenCalledTimes(3);
    for (const entry of await readdir(path.join(store.mediaDir, "mixers"))) {
      expect(await readdir(path.join(store.mediaDir, "mixers", entry))).toEqual([]);
    }
  });

  it("does not return obsolete original-only cues if reanalysis becomes pending during generation", async () => {
    const { store, track } = await libraryFixture();
    store.updateSeparationStatus({ trackId: track.id, status: "running" });
    store.queueBeatAnalysis(track.id);
    store.completeBeatAnalysis(track.id, beatGrid(0.01));
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const generate = vi.fn(async (input: MixerMediaInput, signal?: AbortSignal) => {
      await gate;
      await generateMixerMedia(input, signal);
    });
    const mixer = createMixerMediaService({ store, generate });
    const pending = mixer.get(track.id);
    const rejection = expect(pending).rejects.toMatchObject({ status: 409 });
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    store.queueBeatAnalysis(track.id);
    release();
    await rejection;
    for (const entry of await readdir(path.join(store.mediaDir, "mixers"))) {
      expect(await readdir(path.join(store.mediaDir, "mixers", entry))).toEqual([]);
    }
  });

  it("regenerates if a source changes while the earlier snapshot is being encoded", async () => {
    const { store, track, input } = await libraryFixture();
    let count = 0;
    const generate = vi.fn(async (media: MixerMediaInput, signal?: AbortSignal) => {
      await generateMixerMedia(media, signal);
      if (++count === 1) await writeFile(input.stemPath, pcmWav([7000, 8000], 2600));
    });
    const result = await createMixerMediaService({ store, generate }).get(track.id);
    expect(generate).toHaveBeenCalledTimes(2);
    const pcm = await readGeneratedPcm(path.join(store.mediaDir, result.mediaUrl.slice("/media/".length)));
    expect(pcm.frame(1000).slice(2, 4)).toEqual([7000, 8000]);
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

  it("serves generated WAV with cue revision and byte ranges, then removes it with the track", async () => {
    const { storageDir, track, store, input } = await libraryFixture();
    const server = createApp({ storageDir, analyzeBeats: async () => ({
      analyzedAt: new Date().toISOString(), beats: [], beatsPerBar: [4], downbeats: [], source: "madmom"
    }) }).listen(0);
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing server address.");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const response = await fetch(`${baseUrl}/api/tracks/${track.id}/mixer`);
      const body = await response.json() as { mediaUrl: string; cueRevision: string };
      expect(response.status).toBe(200);
      expect(body.mediaUrl).toMatch(/^\/media\/mixers\/[a-f0-9]+\/[a-f0-9]+\.wav$/);
      expect(body.cueRevision).toBe(cueRevision(null));
      const range = await fetch(`${baseUrl}${body.mediaUrl}`, { headers: { Range: "bytes=0-63" } });
      expect(range.status).toBe(206);
      expect(range.headers.get("content-type")).toMatch(/audio\/(?:x-)?wav/);
      expect((await range.arrayBuffer()).byteLength).toBe(64);
      const missing = await fetch(`${baseUrl}/api/tracks/missing/mixer`);
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({ error: "Track was not found." });
      store.updateSeparationStatus({ trackId: track.id, status: "running" });
      store.queueBeatAnalysis(track.id);
      const incomplete = await fetch(`${baseUrl}/api/tracks/${track.id}/mixer`);
      expect(incomplete.status).toBe(409);
      expect(await incomplete.json()).toEqual({ error: "Separated audio or a completed beat grid must be ready before mixing." });
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
