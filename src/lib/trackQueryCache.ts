import type { QueryClient } from "@tanstack/react-query";
import { trackQueryKey, tracksQueryKey } from "./api";
import type { TrackDetail, TrackSummary } from "./library";
import { removeTrackSummary, upsertTrackSummary } from "./trackCache";

export function cacheTrack(queryClient: QueryClient, track: TrackDetail) {
  queryClient.setQueryData(trackQueryKey(track.id), track);
  queryClient.setQueryData<TrackSummary[]>(tracksQueryKey, (tracks) =>
    upsertTrackSummary(tracks, track)
  );
}

export function removeCachedTrack(queryClient: QueryClient, trackId: string) {
  queryClient.setQueryData<TrackSummary[]>(tracksQueryKey, (tracks) =>
    removeTrackSummary(tracks, trackId)
  );
  queryClient.removeQueries({ queryKey: trackQueryKey(trackId) });
}
