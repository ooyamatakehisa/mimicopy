export type MixerChannelId = "original" | "remainder" | "stem";

export type MixerChannel = {
  muted: boolean;
  solo: boolean;
  volume: number;
};

export type MixerState = Record<MixerChannelId, MixerChannel>;

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
