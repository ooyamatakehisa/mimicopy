/** The carriers are coherent over a 128-frame render quantum at 48 kHz. */
export const audioAuditFrequencies = [375, 750, 1500] as const;

/** Identical, non-repeating amplitude modulation makes source delay measurable. */
export function audioAuditEnvelope(seconds: number): number {
  const position = seconds / 0.04;
  const knot = Math.floor(position);
  const noise = (index: number) => {
    let value = Math.imul(index + 1, 0x45d9f3b);
    value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
    return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff;
  };
  const fraction = (1 - Math.cos(Math.PI * (position - knot))) / 2;
  const envelope = noise(knot) * (1 - fraction) + noise(knot + 1) * fraction;
  return 0.15 + 0.85 * envelope;
}

/** Mono PCM16 WAV. The low level keeps the three-source sum well below clipping. */
export function createAudioAuditWav(
  channelIndex: number,
  durationSeconds = 240
): Buffer {
  if (!Number.isInteger(channelIndex) || channelIndex < 0 || channelIndex > 2) {
    throw new Error("Audio audit channel must be 0, 1 or 2.");
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("Audio audit fixture duration must be positive.");
  }

  const sampleRate = 48_000;
  const sampleCount = Math.ceil(durationSeconds * sampleRate);
  const result = Buffer.alloc(44 + sampleCount * 2);
  result.write("RIFF", 0);
  result.writeUInt32LE(result.length - 8, 4);
  result.write("WAVEfmt ", 8);
  result.writeUInt32LE(16, 16);
  result.writeUInt16LE(1, 20);
  result.writeUInt16LE(1, 22);
  result.writeUInt32LE(sampleRate, 24);
  result.writeUInt32LE(sampleRate * 2, 28);
  result.writeUInt16LE(2, 32);
  result.writeUInt16LE(16, 34);
  result.write("data", 36);
  result.writeUInt32LE(sampleCount * 2, 40);

  const frequency = audioAuditFrequencies[channelIndex];
  for (let frame = 0; frame < sampleCount; frame += 1) {
    const seconds = frame / sampleRate;
    const sample =
      0.025 * audioAuditEnvelope(seconds) * Math.sin(2 * Math.PI * frequency * seconds);
    result.writeInt16LE(Math.round(sample * 32767), 44 + frame * 2);
  }
  return result;
}

/** Distinct L/R carriers expose stereo swaps, downmixing and missing sides. */
export const audioAuditRightFrequencies = [1875, 2250, 2625] as const;
export function createStereoAudioAuditWav(channelIndex: number, durationSeconds = 240): Buffer {
  const mono = createAudioAuditWav(channelIndex, durationSeconds);
  const frames = (mono.length - 44) / 2;
  const result = Buffer.alloc(44 + frames * 4);
  mono.copy(result, 0, 0, 44);
  result.writeUInt32LE(result.length - 8, 4);
  result.writeUInt16LE(2, 22);
  result.writeUInt32LE(48_000 * 4, 28);
  result.writeUInt16LE(4, 32);
  result.writeUInt32LE(frames * 4, 40);
  for (let frame = 0; frame < frames; frame++) {
    const seconds = frame / 48_000;
    result.writeInt16LE(mono.readInt16LE(44 + frame * 2), 44 + frame * 4);
    const right = 0.025 * audioAuditEnvelope(seconds) * Math.sin(2 * Math.PI * audioAuditRightFrequencies[channelIndex] * seconds);
    result.writeInt16LE(Math.round(right * 32767), 46 + frame * 4);
  }
  return result;
}
