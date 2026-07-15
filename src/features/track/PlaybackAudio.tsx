import { useEffect } from "react";
import type { PlaybackState } from "./usePlaybackState";

type PlaybackAudioProps = {
  mediaUrl: string;
  playback: PlaybackState;
};

export function PlaybackAudio({ mediaUrl, playback }: PlaybackAudioProps) {
  const {
    audioRef,
    isPlaying,
    markPaused,
    markPlaying,
    playbackRate,
    syncMediaDuration,
    syncMediaTime
  } = playback;

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    audio.playbackRate = playbackRate;
  }, [audioRef, mediaUrl, playbackRate]);

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio || !isPlaying) {
      return undefined;
    }

    let frameId = 0;

    const update = () => {
      syncMediaTime(audio.currentTime);
      frameId = requestAnimationFrame(update);
    };

    frameId = requestAnimationFrame(update);

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [audioRef, isPlaying, syncMediaTime]);

  return (
    <audio
      ref={audioRef}
      preload="metadata"
      src={mediaUrl}
      onDurationChange={(event) => {
        syncMediaDuration(event.currentTarget.duration);
      }}
      onEnded={markPaused}
      onLoadedMetadata={(event) => {
        syncMediaDuration(event.currentTarget.duration);
      }}
      onPause={markPaused}
      onPlay={markPlaying}
      onTimeUpdate={(event) => {
        syncMediaTime(event.currentTarget.currentTime);
      }}
    />
  );
}
