import { useLocation, useNavigate } from "react-router";
import { nextQueuedTrack, readPlaybackQueue } from "../../lib/playbackQueue";

// Keep the entry list as a snapshot so later library reordering cannot change
// the sequence of an ongoing listening session.
export function usePlaybackSequence(trackId: string | undefined) {
  const location = useLocation();
  const navigate = useNavigate();
  const value: unknown = location.state;
  const state = value && typeof value === "object" ? value : {};
  const queue = readPlaybackQueue("playbackQueue" in state ? state.playbackQueue : null);
  const nextTrackId = nextQueuedTrack(queue, trackId);
  const autoPlayRequested = "autoPlay" in state && state.autoPlay === true;

  return {
    autoPlayRequested,
    nextTrackId,
    queueLabel: queue?.label ?? null,
    consumeAutoPlay: () => {
      void navigate({ pathname: location.pathname, search: location.search }, {
        replace: true, state: { ...state, autoPlay: false }
      });
    },
    advance: () => {
      if (!nextTrackId) return;
      void navigate(`/tracks/${encodeURIComponent(nextTrackId)}`, {
        state: { ...state, activeTrackId: nextTrackId, autoPlay: true }
      });
    }
  };
}

export type PlaybackSequence = ReturnType<typeof usePlaybackSequence>;
