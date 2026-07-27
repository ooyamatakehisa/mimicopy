import { clampTime } from "./playback";

export type TransportAnchor = {
  contextTime: number;
  mediaTime: number;
  playbackRate: number;
};

export type SchedulableAudioPlayer = {
  start: (contextTime: number, mediaTime: number) => unknown;
};

export function startSynchronizedAudioPlayers(
  players: SchedulableAudioPlayer[],
  contextTime: number,
  mediaTime: number
) {
  for (const player of players) {
    player.start(contextTime, mediaTime);
  }
}

export function getTransportMediaTime({
  anchor,
  contextTime,
  duration
}: {
  anchor: TransportAnchor | null;
  contextTime: number;
  duration: number;
}) {
  if (!anchor) {
    return 0;
  }

  const elapsedContextTime = Math.max(0, contextTime - anchor.contextTime);

  return clampTime(
    anchor.mediaTime + elapsedContextTime * anchor.playbackRate,
    duration
  );
}

export function getContextTimeForMediaTime(
  anchor: TransportAnchor | null,
  mediaTime: number
) {
  if (!anchor || anchor.playbackRate <= 0) {
    return null;
  }

  return (
    anchor.contextTime +
    (mediaTime - anchor.mediaTime) / anchor.playbackRate
  );
}
