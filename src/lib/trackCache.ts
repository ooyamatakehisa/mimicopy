import {
  toTrackSummary,
  type TrackDetail,
  type TrackSummary
} from "./library";

export function upsertTrackSummary(
  tracks: TrackSummary[] | undefined,
  track: TrackDetail
) {
  const summary = toTrackSummary(track);
  const existing = tracks ?? [];
  return existing.some((current) => current.id === summary.id)
    ? existing.map((current) => current.id === summary.id ? summary : current)
    : [summary, ...existing];
}

export function removeTrackSummary(
  tracks: TrackSummary[] | undefined,
  trackId: string
) {
  return (tracks ?? []).filter((track) => track.id !== trackId);
}
