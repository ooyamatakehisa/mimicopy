import { useState } from "react";

export type PlaybackMedia = {
  mediaUrl: string;
  kind: "original" | "cue-original" | "separated";
};

/** A prepared source must not interrupt playback, startup, restoration or drain. */
export function usePlaybackMedia(candidate: PlaybackMedia, playbackActive: boolean) {
  const [active, setActive] = useState(candidate);
  const matches = active.mediaUrl === candidate.mediaUrl && active.kind === candidate.kind;
  if (!playbackActive && !matches) {
    // Adjust this component's own state before committing children. An effect
    // would first expose the idle old source and could race a new Play action.
    setActive(candidate);
    return { active: candidate, deferred: false };
  }
  return { active, deferred: !matches };
}
