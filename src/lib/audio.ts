import { buildWaveformPeaks, type WaveformPeak } from "./waveform";

export type DecodedAudio = {
  audioBuffer: AudioBuffer;
  duration: number;
  peaks: WaveformPeak[];
};

let playbackAudioContext: AudioContext | null = null;

export function getPlaybackAudioContext() {
  if (
    playbackAudioContext &&
    playbackAudioContext.state !== "closed"
  ) {
    return playbackAudioContext;
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;

  playbackAudioContext = new AudioContextClass({
    latencyHint: "interactive"
  });

  return playbackAudioContext;
}

export async function decodeAudioBuffer(arrayBuffer: ArrayBuffer) {
  return getPlaybackAudioContext().decodeAudioData(arrayBuffer.slice(0));
}

export async function decodePeaksFromArrayBuffer(
  arrayBuffer: ArrayBuffer
): Promise<DecodedAudio> {
  const audioBuffer = await decodeAudioBuffer(arrayBuffer);

  return {
    audioBuffer,
    duration: audioBuffer.duration,
    peaks: buildWaveformPeaks(audioBuffer, 4_800)
  };
}
