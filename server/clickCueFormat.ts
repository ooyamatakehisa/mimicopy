// This module is also imported by the browser. Keep it free of Node APIs.
export const CLICK_CUE_SAMPLE_RATE = 48_000;
export const CLICK_CUE_PULSE_FRAMES = 48;
export const CLICK_CUE_PCM16 = 24_576;
export const MAX_CLICK_CUE_DURATION_SECONDS = 2 * 60 * 60;

export type ClickCueBeatGrid = {
  beats: readonly { time: number; isDownbeat: boolean }[];
};
export type ClickCueFrame = readonly [frame: number, kind: "normal" | "downbeat"];

/**
 * Quantize to the stored PCM timeline, with one cue per frame. Duplicate
 * timestamps use the downbeat accent. Distinct pulses must have a zero sample
 * between them; silently merging overlapping pulses would lose beat events.
 */
export function getClickCueFrames(beatGrid: ClickCueBeatGrid | null): ClickCueFrame[] {
  const frames = new Map<number, ClickCueFrame[1]>();
  const maximumFrame = MAX_CLICK_CUE_DURATION_SECONDS * CLICK_CUE_SAMPLE_RATE;
  for (const beat of beatGrid?.beats ?? []) {
    if (!Number.isFinite(beat.time) || beat.time < 0) {
      throw new Error("Click beat times must be finite and nonnegative.");
    }
    // A beat at the exact end has no sample in a supported track. This bound
    // uses the format limit, not potentially inaccurate library metadata.
    if (beat.time >= MAX_CLICK_CUE_DURATION_SECONDS) continue;
    const frame = Math.round(beat.time * CLICK_CUE_SAMPLE_RATE);
    if (frame >= maximumFrame) continue;
    if (beat.isDownbeat || !frames.has(frame)) {
      frames.set(frame, beat.isDownbeat ? "downbeat" : "normal");
    }
  }
  const cues: ClickCueFrame[] = [...frames.entries()].sort(([left], [right]) => left - right);
  for (let index = 1; index < cues.length; index += 1) {
    if (cues[index][0] - cues[index - 1][0] <= CLICK_CUE_PULSE_FRAMES) {
      throw new Error("Click beat pulses must be separated by more than 1 ms.");
    }
  }
  return cues;
}

/** Hash these exact UTF-8 bytes with SHA-256 on both the server and browser. */
export function getClickCueRevisionInput(beatGrid: ClickCueBeatGrid | null): string {
  return JSON.stringify(getClickCueFrames(beatGrid));
}
