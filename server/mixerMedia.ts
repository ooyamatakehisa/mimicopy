import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";
import type { LibraryStore } from "./libraryStore.js";
import {
  CLICK_CUE_SAMPLE_RATE,
  getClickCueFrames,
  getClickCueRevisionInput,
  MAX_CLICK_CUE_DURATION_SECONDS,
  type ClickCueFrame
} from "./clickCueFormat.js";
import { writeClickCueWav } from "./clickCueMedia.js";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const sampleRate = CLICK_CUE_SAMPLE_RATE;
const channels = 8;
export const MAX_MIXER_DURATION_SECONDS = MAX_CLICK_CUE_DURATION_SECONDS;
const maxFrames = MAX_MIXER_DURATION_SECONDS * sampleRate;

export class MixerMediaError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export type MixerMediaInput = {
  originalPath: string;
  outputPath: string;
  cues?: readonly ClickCueFrame[];
} & ({
  mode?: "separated";
  stemPath: string;
  remainderPath: string;
} | {
  mode: "original";
  stemPath?: never;
  remainderPath?: never;
});

export type MixerMediaResult = { mediaUrl: string; cueRevision: string };

function getFfmpegPath() {
  const binary = process.env.FFMPEG_PATH ?? require("ffmpeg-static") as unknown;
  if (typeof binary !== "string" || binary.length === 0) {
    throw new Error("ffmpeg binary is not available.");
  }
  return binary;
}

export function mixerMediaArguments(input: MixerMediaInput, cuePath: string) {
  // Explicit channel copies preserve stereo and duplicate mono at unity,
  // matching Web Audio's upmix. ffmpeg's automatic mono upmix is -3 dB.
  const stereo = "aeval='val(0)|val(min(1,nb_in_channels-1))':c=stereo," +
    "aresample=48000:out_chlayout=stereo,asetpts=N/SR/TB";
  const separated = input.mode !== "original";
  const cueIndex = separated ? 3 : 1;
  return [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
    "-i", input.originalPath,
    ...(separated ? ["-i", input.stemPath, "-i", input.remainderPath] : []),
    "-i", cuePath,
    "-filter_complex",
    `[0:a:0]${stereo}[original];` +
      (separated
        ? `[1:a:0]${stereo},apad[stem];[2:a:0]${stereo},apad[remainder];`
        : "anullsrc=r=48000:cl=stereo[stem];anullsrc=r=48000:cl=stereo[remainder];") +
      `[${cueIndex}:a:0]apad,asetpts=N/SR/TB[cues];` +
      "[original][stem][remainder][cues]join=inputs=4:channel_layout=7.1:" +
      "map=0.0-FL|0.1-FR|1.0-FC|1.1-LFE|2.0-BL|2.1-BR|3.0-SL|3.1-SR[mixer]",
    "-map", "[mixer]", "-map_metadata", "-1",
    "-c:a", "pcm_s16le", "-ar", String(sampleRate),
    // Decode slightly beyond the limit so oversized inputs are rejected, not
    // silently truncated. Validate the encoder's actual sample count instead
    // of trusting an input file's possibly missing or dishonest duration.
    "-t", String(MAX_MIXER_DURATION_SECONDS + 0.001),
    "-rf64", "auto", "-f", "wav", input.outputPath
  ];
}

/** Validate our generated PCM container without reading its multi-gigabyte payload. */
export async function validateMixerWav(filePath: string) {
  const file = await open(filePath, "r");
  try {
    const { size } = await file.stat();
    const invalid = () => new Error("The mixer output has invalid or truncated PCM WAV metadata.");
    if (!Number.isSafeInteger(size) || size < 44) throw invalid();
    const read = async (position: number, length: number) => {
      if (position + length > size) throw invalid();
      const bytes = Buffer.alloc(length);
      if ((await file.read(bytes, 0, length, position)).bytesRead !== length) throw invalid();
      return bytes;
    };
    const root = await read(0, 12);
    const container = root.toString("ascii", 0, 4);
    if ((container !== "RIFF" && container !== "RF64") || root.toString("ascii", 8, 12) !== "WAVE") throw invalid();
    const rf64 = container === "RF64";
    if (root.readUInt32LE(4) !== (rf64 ? 0xffffffff : size - 8)) throw invalid();
    let dataSize64: bigint | null = null;
    let sampleCount64: bigint | null = null;
    let formatSeen = false;
    let dataOffset: number | null = null;
    let frames: number | null = null;
    let metadataBytes = 0;
    let chunks = 0;
    // ffmpeg emits only a few small headers. Bound work and allocations even
    // when a cached file has been corrupted; skip PCM by its checked length.
    for (let offset = 12; offset < size;) {
      if (++chunks > 64) throw invalid();
      const chunk = await read(offset, 8);
      const kind = chunk.toString("ascii", 0, 4);
      const declaredLength = chunk.readUInt32LE(4);
      const payload = offset + 8;
      if (rf64 && offset === 12 && kind !== "ds64") throw invalid();
      let length = declaredLength;
      if (kind === "ds64") {
        // Our encoder uses one data chunk and no additional 64-bit chunk table.
        if (!rf64 || offset !== 12 || declaredLength !== 28) throw invalid();
        const ds64 = await read(payload, 28);
        if (ds64.readBigUInt64LE(0) !== BigInt(size - 8) || ds64.readUInt32LE(24) !== 0) throw invalid();
        dataSize64 = ds64.readBigUInt64LE(8);
        sampleCount64 = ds64.readBigUInt64LE(16);
      } else if (kind === "data" && rf64) {
        if (declaredLength !== 0xffffffff || dataSize64 === null || dataSize64 > BigInt(size)) throw invalid();
        length = Number(dataSize64);
      } else if (declaredLength === 0xffffffff) throw invalid();
      const end = payload + length;
      const next = end + length % 2;
      if (next > size) throw invalid();
      if (kind === "fmt ") {
        if (formatSeen || length < 16 || length > 40) throw invalid();
        const format = await read(payload, length);
        const tag = format.readUInt16LE(0);
        if (format.readUInt16LE(2) !== channels || format.readUInt32LE(4) !== sampleRate ||
            format.readUInt32LE(8) !== sampleRate * channels * 2 ||
            format.readUInt16LE(12) !== channels * 2 || format.readUInt16LE(14) !== 16) throw invalid();
        if (tag === 0xfffe) {
          const pcmGuid = Buffer.from("0100000000001000800000aa00389b71", "hex");
          if (length !== 40 || format.readUInt16LE(16) !== 22 || format.readUInt16LE(18) !== 16 ||
              format.readUInt32LE(20) !== 0x63f || !format.subarray(24, 40).equals(pcmGuid)) throw invalid();
        } else if (tag !== 1 || (length !== 16 && !(length === 18 && format.readUInt16LE(16) === 0))) throw invalid();
        formatSeen = true;
      } else if (kind === "data") {
        if (!formatSeen || dataOffset !== null || length === 0 || length % (channels * 2) !== 0) throw invalid();
        frames = length / (channels * 2);
        if (rf64 && sampleCount64 !== BigInt(frames)) throw invalid();
        if (frames > maxFrames) throw new MixerMediaError(413, "Synchronized mixing supports tracks up to 2 hours.");
        dataOffset = payload;
      }
      if (kind !== "data") {
        metadataBytes += 8 + length;
        if (metadataBytes > 1024 * 1024) throw invalid();
      }
      offset = next;
    }
    if (frames === null || dataOffset === null) throw invalid();
    return { frames, sampleRate, channels, dataOffset, container };
  } finally {
    await file.close();
  }
}

/** One transport: original L/R, stem L/R, remainder L/R, normal/downbeat cues. */
export async function generateMixerMedia(
  input: MixerMediaInput,
  ffmpegPathOrSignal: string | AbortSignal = getFfmpegPath(),
  signal?: AbortSignal
) {
  const ffmpegPath = typeof ffmpegPathOrSignal === "string" ? ffmpegPathOrSignal : getFfmpegPath();
  const suppliedSignal = typeof ffmpegPathOrSignal === "string" ? signal : ffmpegPathOrSignal;
  suppliedSignal?.throwIfAborted();
  // A deadline must use the same forced-exit path as explicit cancellation.
  // execFile's own timeout only sends SIGTERM and can wait forever for exit.
  const deadline = AbortSignal.timeout(15 * 60 * 1000);
  const cancellation = suppliedSignal ? AbortSignal.any([suppliedSignal, deadline]) : deadline;
  await mkdir(path.dirname(input.outputPath), { recursive: true });
  const temporaryPath = `${input.outputPath}.${randomUUID()}.tmp`;
  const cuePath = `${temporaryPath}.cues.wav`;
  try {
    cancellation.throwIfAborted();
    await writeClickCueWav(cuePath, input.cues ?? [], cancellation);
    cancellation.throwIfAborted();
    const execution = execFileAsync(ffmpegPath, mixerMediaArguments({ ...input, outputPath: temporaryPath }, cuePath), {
      maxBuffer: 1024 * 1024,
      signal: cancellation
    });
    let closed = false;
    let abortTimeout: ReturnType<typeof setTimeout> | undefined;
    // An AbortError can precede process exit. Keep the files alive until the
    // actual child closes, including a short grace period for ffmpeg cleanup.
    const childClosed = new Promise<void>((resolve) => {
      execution.child.once("close", () => {
        closed = true;
        clearTimeout(abortTimeout);
        resolve();
      });
    });
    const forceAbortedChildToExit = () => {
      if (!closed && abortTimeout === undefined) {
        abortTimeout = setTimeout(() => {
          if (!closed) execution.child.kill("SIGKILL");
        }, 1000);
        abortTimeout.unref();
      }
    };
    cancellation.addEventListener("abort", forceAbortedChildToExit, { once: true });
    if (cancellation.aborted) forceAbortedChildToExit();
    try {
      await execution;
    } finally {
      await childClosed;
      cancellation.removeEventListener("abort", forceAbortedChildToExit);
    }
    cancellation.throwIfAborted();
    await validateMixerWav(temporaryPath);
    cancellation.throwIfAborted();
    await rename(temporaryPath, input.outputPath);
    cancellation.throwIfAborted();
  } finally {
    try {
      await rm(temporaryPath, { force: true });
    } finally {
      await rm(cuePath, { force: true });
    }
  }
}

type MixerStore = Pick<LibraryStore,
  "mediaDir" | "getTrack" | "getMediaFilename" | "getSeparationMediaFilenames" | "getBeatAnalysis">;

export function createMixerMediaService({
  store,
  generate = generateMixerMedia
}: {
  store: MixerStore;
  generate?: (input: MixerMediaInput, signal?: AbortSignal) => Promise<void>;
}) {
  const pending = new Map<string, {
    controller: AbortController;
    promise: Promise<MixerMediaResult>;
  }>();
  const trackDirectory = (trackId: string) =>
    createHash("sha256").update(trackId).digest("hex");
  const cacheDirectory = (trackId: string) =>
    path.join(store.mediaDir, "mixers", trackDirectory(trackId));

  function sourcePath(filename: string) {
    if (path.basename(filename) !== filename || filename.includes("\\")) {
      throw new Error("Invalid library media filename.");
    }
    return path.join(store.mediaDir, filename);
  }

  function readSelection(trackId: string) {
    const track = store.getTrack(trackId);
    const originalFilename = store.getMediaFilename(trackId);
    if (!track || !originalFilename) {
      throw new MixerMediaError(404, "Track was not found.");
    }
    if (track.duration > MAX_MIXER_DURATION_SECONDS) {
      throw new MixerMediaError(413, "Synchronized mixing supports tracks up to 2 hours.");
    }
    const separation = track.separation?.status === "completed"
      ? store.getSeparationMediaFilenames(trackId) : null;
    if (track.separation?.status === "completed" && !separation?.remainderMediaFilename) {
      throw new MixerMediaError(404, "A completed separated audio file was not found.");
    }
    const analysis = store.getBeatAnalysis(trackId);
    const beatGrid = analysis?.status === "completed" ? analysis.beatGrid : null;
    if (!separation && !beatGrid) {
      throw new MixerMediaError(409, "Separated audio or a completed beat grid must be ready before mixing.");
    }
    let cues: ClickCueFrame[];
    let cueRevision: string;
    try {
      cues = getClickCueFrames(beatGrid);
      cueRevision = createHash("sha256").update(getClickCueRevisionInput(beatGrid)).digest("hex");
    } catch (error) {
      throw new MixerMediaError(422, error instanceof Error ? error.message : "Invalid click beat grid.");
    }
    const originalPath = sourcePath(originalFilename);
    const sourceInput = separation?.remainderMediaFilename
      ? { mode: "separated" as const, originalPath, stemPath: sourcePath(separation.mediaFilename),
          remainderPath: sourcePath(separation.remainderMediaFilename) }
      : { mode: "original" as const, originalPath };
    return {
      sourceInput, cues, cueRevision,
      // Analysis timestamps do not affect the encoded samples. A reanalysis
      // with identical cue frames can reuse the same immutable cache file.
      selectionKey: JSON.stringify([sourceInput, cueRevision])
    };
  }

  async function readSnapshot(trackId: string, signal: AbortSignal) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      signal.throwIfAborted();
      const selection = readSelection(trackId);
      const source = selection.sourceInput;
      const inputPaths = source.mode === "separated"
        ? [source.originalPath, source.stemPath, source.remainderPath] : [source.originalPath];
      const inputs = await Promise.all(inputPaths.map(async (inputPath) => {
        const metadata = await stat(inputPath).catch((error: unknown) => {
          if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            throw new MixerMediaError(404, "A source audio file was not found.");
          }
          throw error;
        });
        if (!metadata.isFile()) {
          throw new MixerMediaError(404, "A source audio file was not found.");
        }
        return [path.basename(inputPath), metadata.size, metadata.mtimeMs, metadata.ctimeMs];
      }));
      signal.throwIfAborted();
      // A reanalysis or completed separation may change while stat() awaits.
      if (readSelection(trackId).selectionKey !== selection.selectionKey) continue;
      const fingerprint = createHash("sha256")
        .update(JSON.stringify(["pcm16-48k-8ch-cues-rf64-auto-v2", inputs, selection.cueRevision]))
        .digest("hex");
      const outputPath = path.join(cacheDirectory(trackId), `${fingerprint}.wav`);
      return { ...selection, fingerprint, outputPath };
    }
    throw new MixerMediaError(409, "Audio sources or beat analysis changed while preparing synchronized audio. Please retry.");
  }

  async function prepare(trackId: string, signal: AbortSignal): Promise<MixerMediaResult> {
    let snapshot = await readSnapshot(trackId, signal);
    // One promise per track follows the latest snapshot. New callers cannot
    // accidentally join a promise that returns an obsolete grid. Bound work
    // when a track is repeatedly changed during generation.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      signal.throwIfAborted();
      const cached = await stat(snapshot.outputPath).catch((error: unknown) => {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
        throw error;
      });
      signal.throwIfAborted();
      if (cached) await validateMixerWav(snapshot.outputPath);
      let generated = false;
      try {
        if (!cached) {
          await generate({ ...snapshot.sourceInput, cues: snapshot.cues, outputPath: snapshot.outputPath }, signal);
          generated = true;
        }
      } catch (error) {
        signal.throwIfAborted();
        const latest = await readSnapshot(trackId, signal);
        if (latest.fingerprint === snapshot.fingerprint) throw error;
        snapshot = latest;
        continue;
      }
      signal.throwIfAborted();
      let latest: Awaited<ReturnType<typeof readSnapshot>>;
      try {
        latest = await readSnapshot(trackId, signal);
      } catch (error) {
        if (generated) await rm(snapshot.outputPath, { force: true });
        throw error;
      }
      if (latest.fingerprint === snapshot.fingerprint) {
        return {
          mediaUrl: `/media/mixers/${trackDirectory(trackId)}/${snapshot.fingerprint}.wav`,
          cueRevision: snapshot.cueRevision
        };
      }
      // This newly encoded file was never advertised. If its source changed
      // mid-decode it must not be reused even if an older grid later returns.
      if (generated) await rm(snapshot.outputPath, { force: true });
      snapshot = latest;
    }
    throw new MixerMediaError(409, "Audio sources or beat analysis changed repeatedly. Please retry.");
  }

  return {
    get(trackId: string) {
      const current = pending.get(trackId);
      if (current) return current.promise;
      const controller = new AbortController();
      const result = prepare(trackId, controller.signal).catch((error: unknown) => {
        if (!store.getTrack(trackId)) throw new MixerMediaError(404, "Track was not found.");
        throw error;
      }).finally(() => {
        if (pending.get(trackId)?.controller === controller) pending.delete(trackId);
      });
      pending.set(trackId, { controller, promise: result });
      return result;
    },
    async remove(trackId: string) {
      const current = pending.get(trackId);
      current?.controller.abort();
      await current?.promise.catch(() => undefined);
      await rm(cacheDirectory(trackId), { force: true, recursive: true });
    }
  };
}
