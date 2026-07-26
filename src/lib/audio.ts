import { buildWaveformPeaks, type WaveformPeak } from "./waveform";

export type DecodedAudio = {
  audioBuffer: AudioBuffer;
  duration: number;
  peaks: WaveformPeak[];
};

type AudioSessionType =
  | "ambient"
  | "auto"
  | "play-and-record"
  | "playback"
  | "transient"
  | "transient-solo";

type AudioSessionNavigator = {
  readonly audioSession?: {
    type: AudioSessionType;
  };
};

let playbackAudioContext: AudioContext | null = null;

export function configurePlaybackAudioSession(
  navigatorObject: AudioSessionNavigator
) {
  if (navigatorObject.audioSession) {
    navigatorObject.audioSession.type = "playback";
  }
}

export function getPlaybackAudioContext() {
  if (
    playbackAudioContext &&
    playbackAudioContext.state !== "closed"
  ) {
    return playbackAudioContext;
  }

  configurePlaybackAudioSession(navigator as AudioSessionNavigator);

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
