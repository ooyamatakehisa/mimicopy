import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";
import type { LibraryStore } from "./libraryStore.js";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const sampleRate = 48_000;
const channels = 6;
const bytesPerFrame = channels * 2;
export const MAX_MIXER_DURATION_SECONDS = 2 * 60 * 60;
const maxPcmBytes = MAX_MIXER_DURATION_SECONDS * sampleRate * bytesPerFrame;

export class MixerMediaError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export type MixerMediaInput = {
  originalPath: string;
  stemPath: string;
  remainderPath: string;
  outputPath: string;
};

function getFfmpegPath() {
  const binary = process.env.FFMPEG_PATH ?? require("ffmpeg-static") as unknown;
  if (typeof binary !== "string" || binary.length === 0) {
    throw new Error("ffmpeg binary is not available.");
  }
  return binary;
}

export function mixerMediaArguments(input: MixerMediaInput) {
  // Explicit channel copies preserve stereo and duplicate mono at unity,
  // matching Web Audio's upmix. ffmpeg's automatic mono upmix is -3 dB.
  const stereo = "aeval='val(0)|val(min(1,nb_in_channels-1))':c=stereo," +
    "aresample=48000:out_chlayout=stereo,asetpts=N/SR/TB";
  return [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
    "-i", input.originalPath,
    "-i", input.stemPath,
    "-i", input.remainderPath,
    "-filter_complex",
    `[0:a:0]${stereo}[original];` +
      `[1:a:0]${stereo},apad[stem];` +
      `[2:a:0]${stereo},apad[remainder];` +
      "[original][stem][remainder]join=inputs=3:channel_layout=5.1:" +
      "map=0.0-FL|0.1-FR|1.0-FC|1.1-LFE|2.0-BL|2.1-BR[mixer]",
    "-map", "[mixer]", "-map_metadata", "-1",
    "-c:a", "pcm_s16le", "-ar", String(sampleRate),
    // Decode slightly beyond the limit so oversized inputs are rejected, not
    // silently truncated. Even dishonest/missing duration metadata cannot
    // overflow a RIFF WAV's 32-bit size fields (2 hours is about 4.15 GB).
    "-t", String(MAX_MIXER_DURATION_SECONDS + 0.001),
    "-rf64", "never", "-f", "wav", input.outputPath
  ];
}

async function validateMixerWav(filePath: string) {
  const file = await open(filePath, "r");
  try {
    const { size } = await file.stat();
    const header = Buffer.alloc(4096);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    if (header.toString("ascii", 0, 4) !== "RIFF" ||
        header.toString("ascii", 8, 12) !== "WAVE") {
      throw new Error("The mixer output is not a RIFF WAV.");
    }
    let validFormat = false;
    for (let offset = 12; offset + 8 <= bytesRead;) {
      const kind = header.toString("ascii", offset, offset + 4);
      const length = header.readUInt32LE(offset + 4);
      const dataOffset = offset + 8;
      if (kind === "fmt " && length >= 16 && dataOffset + length <= bytesRead) {
        const format = header.readUInt16LE(dataOffset);
        const isPcm = format === 1 ||
          (format === 0xfffe && length >= 40 && header.readUInt16LE(dataOffset + 24) === 1);
        validFormat = isPcm && header.readUInt16LE(dataOffset + 2) === channels &&
          header.readUInt32LE(dataOffset + 4) === sampleRate &&
          header.readUInt16LE(dataOffset + 12) === bytesPerFrame &&
          header.readUInt16LE(dataOffset + 14) === 16;
      }
      if (kind === "data") {
        if (length > maxPcmBytes) {
          throw new MixerMediaError(413, "Synchronized mixing supports tracks up to 2 hours.");
        }
        if (!validFormat || length === 0 || length % bytesPerFrame !== 0 ||
            dataOffset + length !== size) {
          throw new Error("The mixer output has invalid audio data.");
        }
        return;
      }
      offset = dataOffset + length + (length % 2);
    }
    throw new Error("The mixer output is missing its audio data.");
  } finally {
    await file.close();
  }
}

/** One transport, with original L/R, stem L/R, remainder L/R in that order. */
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
  try {
    cancellation.throwIfAborted();
    const execution = execFileAsync(ffmpegPath, mixerMediaArguments({ ...input, outputPath: temporaryPath }), {
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
    await rm(temporaryPath, { force: true });
  }
}

type MixerStore = Pick<LibraryStore,
  "mediaDir" | "getTrack" | "getMediaFilename" | "getSeparationMediaFilenames">;

export function createMixerMediaService({
  store,
  generate = generateMixerMedia
}: {
  store: MixerStore;
  generate?: (input: MixerMediaInput, signal?: AbortSignal) => Promise<void>;
}) {
  const pending = new Map<string, {
    controller: AbortController;
    promise: Promise<{ mediaUrl: string }>;
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

  async function prepare(trackId: string, signal: AbortSignal) {
    signal.throwIfAborted();
    const track = store.getTrack(trackId);
    const originalFilename = store.getMediaFilename(trackId);
    if (!track || !originalFilename) {
      throw new MixerMediaError(404, "Track was not found.");
    }
    const separation = store.getSeparationMediaFilenames(trackId);
    if (track.separation?.status !== "completed" || !separation?.remainderMediaFilename) {
      throw new MixerMediaError(409, "Both separated sources must be ready before mixing.");
    }
    if (track.duration > MAX_MIXER_DURATION_SECONDS) {
      throw new MixerMediaError(413, "Synchronized mixing supports tracks up to 2 hours.");
    }
    const originalPath = sourcePath(originalFilename);
    const stemPath = sourcePath(separation.mediaFilename);
    const remainderPath = sourcePath(separation.remainderMediaFilename);
    const inputPaths = [originalPath, stemPath, remainderPath];
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
      return [path.basename(inputPath), metadata.size, metadata.mtimeMs];
    }));
    signal.throwIfAborted();
    const fingerprint = createHash("sha256").update(JSON.stringify(["pcm16-48k-v2", inputs])).digest("hex");
    const outputPath = path.join(cacheDirectory(trackId), `${fingerprint}.wav`);
    const cached = await stat(outputPath).catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    });
    signal.throwIfAborted();
    if (!cached) {
      await generate({ originalPath, stemPath, remainderPath, outputPath }, signal);
    }
    signal.throwIfAborted();
    // A deletion may have happened while ffmpeg was running. Never advertise
    // the output of a deleted track; remove() also waits before deleting it.
    if (!store.getTrack(trackId)) {
      throw new MixerMediaError(404, "Track was not found.");
    }
    return { mediaUrl: `/media/mixers/${trackDirectory(trackId)}/${fingerprint}.wav` };
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
