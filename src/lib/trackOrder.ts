export function moveTrackToIndex(ids: string[], trackId: string, targetIndex: number) {
  const current = ids.indexOf(trackId);
  if (current < 0 || targetIndex < 0 || targetIndex >= ids.length || current === targetIndex) return ids;
  const next = ids.filter((id) => id !== trackId);
  next.splice(targetIndex, 0, trackId);
  return next;
}

export type TrackOrderDragData = { kind: "track-order"; trackId: string; title: string };

export function readTrackOrderDragData(value: unknown): TrackOrderDragData | null {
  if (!value || typeof value !== "object" || !("kind" in value) || value.kind !== "track-order" ||
    !("trackId" in value) || typeof value.trackId !== "string" ||
    !("title" in value) || typeof value.title !== "string") return null;
  return { kind: "track-order", trackId: value.trackId, title: value.title };
}
