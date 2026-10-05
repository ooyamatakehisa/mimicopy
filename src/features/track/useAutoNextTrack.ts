import { useEffect, useState } from "react";
import type { PlaybackSequence } from "./usePlaybackSequence";

export const autoNextStorageKey = "mimicopy.autoNextTrack";

export function useAutoNextTrack(sequence?: PlaybackSequence) {
  const [enabled, setEnabled] = useState(() => {
    try { return localStorage.getItem(autoNextStorageKey) === "true"; }
    catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem(autoNextStorageKey, String(enabled)); }
    catch { /* Playback still works when browser storage is unavailable. */ }
  }, [enabled]);

  return {
    enabled,
    setEnabled,
    description: !sequence?.queueLabel
      ? "曲一覧から開くと、その順番で再生します。"
      : sequence.nextTrackId
        ? `${sequence.queueLabel}の順番で再生します。`
        : `${sequence.queueLabel}の最後の曲です。再生後に停止します。`,
    onPlaybackEnded: () => {
      if (enabled) sequence?.advance();
    }
  };
}

export type AutoNextTrack = ReturnType<typeof useAutoNextTrack>;
