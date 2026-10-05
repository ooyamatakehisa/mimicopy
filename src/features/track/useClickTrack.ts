import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BeatGrid } from "../../lib/beats";

type UseClickTrackOptions = {
  audioContext: AudioContext | null;
  beatGrid: BeatGrid | null;
  hasCueTransport: boolean;
  setEnabled(enabled: boolean): void;
};

/** Owns the click preference; the shared native stream owns beat timing. */
export function useClickTrack({ audioContext, beatGrid, hasCueTransport, setEnabled }: UseClickTrackOptions) {
  const enabledRef = useRef(false);
  const attemptRef = useRef(0);
  const [isClickEnabled, setIsClickEnabled] = useState(false);
  const [clickErrorMessage, setClickErrorMessage] = useState<string | null>(null);
  const isClickAvailable = Boolean(audioContext && hasCueTransport && beatGrid?.beats.length);
  const disableClickTrack = useCallback(() => {
    attemptRef.current++;
    enabledRef.current = false;
    setEnabled(false);
    setIsClickEnabled(false);
  }, [setEnabled]);
  const toggleClickTrack = useCallback(() => {
    setClickErrorMessage(null);
    if (!isClickAvailable || !audioContext) {
      disableClickTrack();
      return;
    }
    const attempt = ++attemptRef.current;
    const next = !enabledRef.current;
    enabledRef.current = next;
    setIsClickEnabled(next);
    setEnabled(next);
    if (next) {
      // Resume inside the trusted gesture. Cue samples own timing; reading
      // media.currentTime would reintroduce a second, mismatched clock.
      void audioContext.resume().catch(() => {
        if (!enabledRef.current || attempt !== attemptRef.current) return;
        disableClickTrack();
        setClickErrorMessage("クリック音の再生を開始できませんでした。");
      });
    }
  }, [audioContext, disableClickTrack, isClickAvailable, setEnabled]);

  useEffect(() => {
    // A late resume rejection from the replaced graph cannot change the new
    // graph's click preference, even when the beat grid remains identical.
    attemptRef.current++;
  }, [audioContext]);

  useEffect(() => {
    disableClickTrack();
    return () => { attemptRef.current++; setEnabled(false); };
  }, [beatGrid, hasCueTransport, disableClickTrack, setEnabled]);

  return useMemo(() => ({ clickErrorMessage, isClickAvailable, isClickEnabled,
    disableClickTrack, toggleClickTrack }),
  [clickErrorMessage, disableClickTrack, isClickAvailable, isClickEnabled, toggleClickTrack]);
}

export type ClickTrackState = ReturnType<typeof useClickTrack>;
