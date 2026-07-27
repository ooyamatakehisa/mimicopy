export type MixerChannelId = "original" | "remainder" | "stem";

export type MixerChannel = {
  muted: boolean;
  solo: boolean;
  volume: number;
};

export type MixerState = Record<MixerChannelId, MixerChannel>;

const mutedFollowerSyncThreshold = 0.075;
const audibleDriftCorrectionStartThreshold = 0.03;
const audibleDriftCorrectionStopThreshold = 0.01;
const playbackRateCorrectionRatio = 0.02;
const minimumMediaPlaybackRate = 0.25;
const maximumMediaPlaybackRate = 4;

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

export function shouldHardSyncMixerFollower({
  driftSeconds,
  followerVolume
}: {
  driftSeconds: number;
  followerVolume: number;
}) {
  if (!Number.isFinite(driftSeconds)) {
    return false;
  }

  return (
    followerVolume === 0 &&
    Math.abs(driftSeconds) > mutedFollowerSyncThreshold
  );
}

export function getMixerFollowerPlaybackRate({
  basePlaybackRate,
  currentPlaybackRate,
  driftSeconds,
  followerVolume
}: {
  basePlaybackRate: number;
  currentPlaybackRate: number;
  driftSeconds: number;
  followerVolume: number;
}) {
  if (
    !Number.isFinite(basePlaybackRate) ||
    basePlaybackRate <= 0 ||
    !Number.isFinite(currentPlaybackRate) ||
    !Number.isFinite(driftSeconds) ||
    followerVolume === 0
  ) {
    return basePlaybackRate;
  }

  const isCorrecting =
    Math.abs(currentPlaybackRate - basePlaybackRate) > 0.001;
  const threshold = isCorrecting
    ? audibleDriftCorrectionStopThreshold
    : audibleDriftCorrectionStartThreshold;

  if (Math.abs(driftSeconds) <= threshold) {
    return basePlaybackRate;
  }

  const correction =
    driftSeconds > 0
      ? -playbackRateCorrectionRatio
      : playbackRateCorrectionRatio;

  return Math.max(
    minimumMediaPlaybackRate,
    Math.min(
      maximumMediaPlaybackRate,
      basePlaybackRate * (1 + correction)
    )
  );
}
