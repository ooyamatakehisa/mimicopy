import { buildWaveformPeaks, type WaveformPeak } from "./waveform";

export type DecodedAudio = {
  duration: number;
  peaks: WaveformPeak[];
};

export async function decodePeaksFromArrayBuffer(
  arrayBuffer: ArrayBuffer
): Promise<DecodedAudio> {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const audioContext = new AudioContextClass();

  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));

    return {
      duration: audioBuffer.duration,
      peaks: buildWaveformPeaks(audioBuffer, 4_800)
    };
  } finally {
    await audioContext.close();
  }
}
