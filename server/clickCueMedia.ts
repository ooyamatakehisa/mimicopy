import { open, type FileHandle } from "node:fs/promises";
import {
  CLICK_CUE_PCM16,
  CLICK_CUE_PULSE_FRAMES,
  CLICK_CUE_SAMPLE_RATE,
  MAX_CLICK_CUE_DURATION_SECONDS,
  type ClickCueFrame
} from "./clickCueFormat.js";

async function writeAt(file: FileHandle, bytes: Buffer, position: number) {
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await file.write(bytes, offset, bytes.length - offset, position + offset);
    if (bytesWritten === 0) throw new Error("Could not write click cue audio.");
    offset += bytesWritten;
  }
}

/** Sparse stereo PCM: normal cue on the left, downbeat cue on the right. */
export async function writeClickCueWav(filePath: string, cues: readonly ClickCueFrame[], signal?: AbortSignal) {
  signal?.throwIfAborted();
  const maximumFrames = MAX_CLICK_CUE_DURATION_SECONDS * CLICK_CUE_SAMPLE_RATE;
  let previousFrame = -CLICK_CUE_PULSE_FRAMES - 1;
  for (const [frame, kind] of cues) {
    if (!Number.isSafeInteger(frame) || frame < 0 || frame >= maximumFrames ||
        frame - previousFrame <= CLICK_CUE_PULSE_FRAMES || (kind !== "normal" && kind !== "downbeat")) {
      throw new Error("Invalid normalized click cue frames.");
    }
    previousFrame = frame;
  }
  const frameCount = Math.max(1, Math.min(maximumFrames, (cues.at(-1)?.[0] ?? 0) + CLICK_CUE_PULSE_FRAMES));
  const dataBytes = frameCount * 4;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(CLICK_CUE_SAMPLE_RATE, 24);
  header.writeUInt32LE(CLICK_CUE_SAMPLE_RATE * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataBytes, 40);
  const normal = Buffer.alloc(CLICK_CUE_PULSE_FRAMES * 4);
  const downbeat = Buffer.alloc(CLICK_CUE_PULSE_FRAMES * 4);
  for (let frame = 0; frame < CLICK_CUE_PULSE_FRAMES; frame += 1) {
    normal.writeInt16LE(CLICK_CUE_PCM16, frame * 4);
    downbeat.writeInt16LE(CLICK_CUE_PCM16, frame * 4 + 2);
  }

  const file = await open(filePath, "wx");
  try {
    // Unwritten regions read as zero; no full-track PCM allocation is needed.
    await file.truncate(44 + dataBytes);
    await writeAt(file, header, 0);
    for (const [frame, kind] of cues) {
      signal?.throwIfAborted();
      const pulse = kind === "downbeat" ? downbeat : normal;
      await writeAt(file, pulse.subarray(0, Math.min(CLICK_CUE_PULSE_FRAMES, frameCount - frame) * 4), 44 + frame * 4);
    }
    signal?.throwIfAborted();
  } finally {
    await file.close();
  }
}
