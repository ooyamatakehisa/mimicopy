export type PlaybackQueue = {
  trackIds: string[];
  label: string;
};

export function readPlaybackQueue(value: unknown): PlaybackQueue | null {
  if (!value || typeof value !== "object" ||
      !("trackIds" in value) || !Array.isArray(value.trackIds) ||
      !value.trackIds.every((id: unknown) => typeof id === "string" && id.length > 0) ||
      !("label" in value) || typeof value.label !== "string") return null;
  return { trackIds: value.trackIds, label: value.label };
}

export function nextQueuedTrack(queue: PlaybackQueue | null, trackId: string | undefined) {
  if (!queue || !trackId) return null;
  const index = queue.trackIds.indexOf(trackId);
  return index < 0 ? null : queue.trackIds[index + 1] ?? null;
}
