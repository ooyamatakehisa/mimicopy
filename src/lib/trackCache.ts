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
  const remainingTracks = (tracks ?? []).filter(
    (currentTrack) => currentTrack.id !== summary.id
  );

  return [summary, ...remainingTracks].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  );
}

export function removeTrackSummary(
  tracks: TrackSummary[] | undefined,
  trackId: string
) {
  return (tracks ?? []).filter((track) => track.id !== trackId);
}
