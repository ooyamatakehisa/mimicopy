export type MixerChannelId = "original" | "remainder" | "stem";

export type MixerChannel = {
  muted: boolean;
  solo: boolean;
  volume: number;
};

export type MixerState = Record<MixerChannelId, MixerChannel>;

export type MixerGainRamp = {
  from: number;
  to: number;
  startTime: number;
  endTime: number;
};

/** The owned automation trajectory also handles a reversal during a fade. */
export function getMixerGainAtTime(ramp: MixerGainRamp, time: number) {
  if (time >= ramp.endTime || ramp.endTime <= ramp.startTime) return ramp.to;
  const progress = Math.max(0, (time - ramp.startTime) / (ramp.endTime - ramp.startTime));
  return ramp.from + (ramp.to - ramp.from) * progress;
}

export const defaultMixerState: MixerState = {
  original: {
    muted: false,
    solo: false,
    volume: 1
  },
  remainder: {
    muted: false,
    solo: false,
    volume: 1
  },
  stem: {
    muted: false,
    solo: false,
    volume: 1
  }
};

export function clampMixerVolume(volume: number) {
  if (!Number.isFinite(volume)) {
    return 1;
  }

  return Math.min(1, Math.max(0, volume));
}

export function getEffectiveMixerVolume(
  channels: MixerState,
  channelId: MixerChannelId
) {
  const channel = channels[channelId];
  const hasSolo = Object.values(channels).some((candidate) => candidate.solo);

  if (channel.muted || (hasSolo && !channel.solo)) {
    return 0;
  }

  return clampMixerVolume(channel.volume);
}
