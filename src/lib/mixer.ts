export type MixerChannelId = "original" | "remainder" | "stem";

export type MixerChannel = {
  muted: boolean;
  solo: boolean;
  volume: number;
};

export type MixerState = Record<MixerChannelId, MixerChannel>;

const audibleFollowerSyncThreshold = 0.5;
const mutedFollowerSyncThreshold = 0.075;

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

export function getMixerPlaybackClock({
  hasRemainder,
  hasStem,
  originalVolume,
  remainderVolume,
  stemVolume
}: {
  hasRemainder: boolean;
  hasStem: boolean;
  originalVolume: number;
  remainderVolume: number;
  stemVolume: number;
}): MixerChannelId {
  if (originalVolume > 0) {
    return "original";
  }
  if (hasStem && stemVolume > 0) {
    return "stem";
  }
  if (hasRemainder && remainderVolume > 0) {
    return "remainder";
  }

  return "original";
}

export function shouldResyncMixerFollower({
  driftSeconds,
  followerVolume
}: {
  driftSeconds: number;
  followerVolume: number;
}) {
  if (!Number.isFinite(driftSeconds)) {
    return false;
  }

  const threshold =
    followerVolume === 0
      ? mutedFollowerSyncThreshold
      : audibleFollowerSyncThreshold;

  return Math.abs(driftSeconds) > threshold;
}
