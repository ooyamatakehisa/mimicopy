import type { BeatGrid } from "../src/lib/beats";

export const clickAuditDuration = 30;
export const clickAuditSampleRate = 48_000;
export const clickAuditPulseFrames = 960;
export const clickAuditHannCenterSeconds = (clickAuditPulseFrames - 1) / (2 * clickAuditSampleRate);
export const clickAuditBeatTimes = Array.from({ length: clickAuditDuration * 2 }, (_, index) => index / 2);
export const clickAuditBeatGrid: BeatGrid = {
  analyzedAt: "2026-10-05T00:00:00.000Z", source: "madmom", beatsPerBar: [4],
  beats: clickAuditBeatTimes.map((time, index) => ({ time, position: index % 4 + 1, isDownbeat: index % 4 === 0 })),
  downbeats: clickAuditBeatTimes.filter((_, index) => index % 4 === 0)
};

/** Unique carriers identify individual beats even if startup skips a pulse. */
export const clickAuditPulseFrequency = (beatIndex: number) => 600 + beatIndex * 64;

/** A 20 ms Hann pulse begins exactly on every supplied beat. */
export function createClickAuditWav() {
  const sampleRate = clickAuditSampleRate;
  const frames = clickAuditDuration * sampleRate;
  const wav = Buffer.alloc(44 + frames * 4);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 4, 28);
  wav.writeUInt16LE(4, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(frames * 4, 40);
  for (const [beatIndex, time] of clickAuditBeatTimes.entries()) {
    for (let frame = 0; frame < clickAuditPulseFrames; frame++) {
      const envelope = (1 - Math.cos(2 * Math.PI * frame / (clickAuditPulseFrames - 1))) / 2;
      const sample = Math.round(0.08 * envelope * Math.sin(2 * Math.PI * clickAuditPulseFrequency(beatIndex) * frame / sampleRate) * 32767);
      const offset = 44 + (Math.round(time * sampleRate) + frame) * 4;
      wav.writeInt16LE(sample, offset);
      wav.writeInt16LE(sample, offset + 2);
    }
  }
  return wav;
}
