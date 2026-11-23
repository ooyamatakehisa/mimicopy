import { clampMixerVolume, defaultMixerState, type MixerChannelId, type MixerState } from "./mixer";
import { defaultPlaybackRate, playbackRates, type PlaybackRate } from "./playback";
import { clampTransposeSemitones, defaultTransposeSemitones } from "./transpose";
import { clampWaveformZoom, defaultWaveformZoom } from "./waveform";

export type TrackSettings = {
  channels: MixerState;
  playbackRate: PlaybackRate;
  semitones: number;
  waveformZoom: number;
};

const mixerChannels = ["original", "stem", "remainder"] as const;

function readNumber(params: URLSearchParams, key: string, fallback: number) {
  const raw = params.get(key);
  const value = raw?.trim() ? Number(raw) : NaN;
  return Number.isFinite(value) ? value : fallback;
}

export function readTrackSettings(search: string): TrackSettings {
  const params = new URLSearchParams(search);
  const speed = readNumber(params, "speed", defaultPlaybackRate);
  const readChannel = (id: MixerChannelId) => ({
    muted: params.get(`${id}Mute`) === "1",
    solo: params.get(`${id}Solo`) === "1",
    volume: clampMixerVolume(readNumber(params, `${id}Gain`, defaultMixerState[id].volume))
  });

  return {
    channels: {
      original: readChannel("original"),
      stem: readChannel("stem"),
      remainder: readChannel("remainder")
    },
    playbackRate: playbackRates.find((rate) => rate === speed) ?? defaultPlaybackRate,
    semitones: clampTransposeSemitones(readNumber(params, "transpose", defaultTransposeSemitones)),
    waveformZoom: clampWaveformZoom(readNumber(params, "zoom", defaultWaveformZoom))
  };
}

export function writeTrackSettings(search: string, settings: TrackSettings) {
  const params = new URLSearchParams(search);
  const write = (key: string, value: number | boolean, defaultValue: number | boolean) => {
    if (value === defaultValue) params.delete(key);
    else params.set(key, String(Number(value)));
  };

  write("transpose", settings.semitones, defaultTransposeSemitones);
  write("speed", settings.playbackRate, defaultPlaybackRate);
  write("zoom", settings.waveformZoom, defaultWaveformZoom);

  for (const id of mixerChannels) {
    const channel = settings.channels[id];
    write(`${id}Gain`, channel.volume, defaultMixerState[id].volume);
    write(`${id}Mute`, channel.muted, defaultMixerState[id].muted);
    write(`${id}Solo`, channel.solo, defaultMixerState[id].solo);
  }

  return params.size ? `?${params}` : "";
}
