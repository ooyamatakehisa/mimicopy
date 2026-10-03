import { useEffect } from "react";
import type { PlaybackState } from "./usePlaybackState";

/** Key this component by media URL so a replacement gets its own source node. */
export function PlaybackAudio({ mediaUrl, playback }: {
  mediaUrl: string;
  playback: PlaybackState;
}) {
  const { audioRef, bindAudio, isPlaying, markPaused, markEnded, markPlaying, playbackRate,
    reportMediaError, restoreMetadata, restoreSeeked, syncMediaDuration, syncMediaTime, syncPlaybackRate } = playback;

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) return bindAudio(audio);
  }, [audioRef, bindAudio]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    syncPlaybackRate(playbackRate);
    // All channel levels live in the audio graph; iOS ignores media.volume.
    audio.volume = 1;
  }, [audioRef, playbackRate, syncPlaybackRate]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !isPlaying) return;
    let frame = 0;
    const update = () => {
      syncMediaTime(audio.currentTime);
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [audioRef, isPlaying, syncMediaTime]);

  return (
    <audio
      ref={audioRef}
      aria-label="Original audio"
      preload="auto"
      src={mediaUrl}
      onDurationChange={(event) => syncMediaDuration(event.currentTarget.duration)}
      onLoadedMetadata={(event) => {
        syncMediaDuration(event.currentTarget.duration);
        restoreMetadata(event.currentTarget);
      }}
      onSeeked={(event) => restoreSeeked(event.currentTarget)}
      onEnded={markEnded}
      onError={() => reportMediaError("音源")}
      onPause={markPaused}
      onPlay={markPlaying}
      onTimeUpdate={(event) => syncMediaTime(event.currentTarget.currentTime)}
    />
  );
}
