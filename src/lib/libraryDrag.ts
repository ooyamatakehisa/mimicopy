import type { TrackSummary } from "./library";

export type TrackDragData = {
  kind: "tracks";
  trackIds: string[];
  title: string;
};

export type FolderDropData = {
  kind: "folder";
  folderId: string | null;
  name: string;
};

export function readTrackDragData(value: unknown): TrackDragData | null {
  if (
    !value ||
    typeof value !== "object" ||
    !("kind" in value) ||
    value.kind !== "tracks" ||
    !("title" in value) ||
    typeof value.title !== "string" ||
    !("trackIds" in value) ||
    !Array.isArray(value.trackIds) ||
    value.trackIds.length === 0 ||
    !value.trackIds.every(
      (id): id is string => typeof id === "string" && id.length > 0
    )
  )
    return null;
  return {
    kind: "tracks",
    title: value.title,
    trackIds: [...new Set(value.trackIds)]
  };
}

export function readFolderDropData(value: unknown): FolderDropData | null {
  if (
    !value ||
    typeof value !== "object" ||
    !("kind" in value) ||
    value.kind !== "folder" ||
    !("name" in value) ||
    typeof value.name !== "string" ||
    !("folderId" in value) ||
    (value.folderId !== null && typeof value.folderId !== "string")
  )
    return null;
  return { kind: "folder", name: value.name, folderId: value.folderId };
}

export function getTrackMove(
  source: unknown,
  target: unknown,
  tracks: TrackSummary[]
) {
  const drag = readTrackDragData(source);
  const drop = readFolderDropData(target);
  if (!drag || !drop || drag.trackIds.length > 500) return null;
  const byId = new Map(tracks.map((track) => [track.id, track]));
  if (drag.trackIds.some((id) => !byId.has(id))) return null;
  const trackIds = drag.trackIds.filter(
    (id) => byId.get(id)?.folderId !== drop.folderId
  );
  return trackIds.length ? { trackIds, folderId: drop.folderId } : null;
}
