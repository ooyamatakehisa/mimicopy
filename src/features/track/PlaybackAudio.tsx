import { useEffect } from "react";
import {
  getMixerPlaybackClock,
  shouldResyncMixerFollower
} from "../../lib/mixer";
import type { PlaybackState } from "./usePlaybackState";

type PlaybackAudioProps = {
  mediaUrl: string;
  originalVolume: number;
  playback: PlaybackState;
  stemMediaUrl: string | null;
  stemVolume: number;
};

export function PlaybackAudio({
  mediaUrl,
  originalVolume,
  playback,
  stemMediaUrl,
  stemVolume
}: PlaybackAudioProps) {
  const {
    audioRef,
    isPlaying,
    markPaused,
    markPlaying,
    playbackRate,
    stemAudioRef,
    syncMediaDuration,
    syncMediaTime
  } = playback;

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    audio.playbackRate = playbackRate;
    audio.volume = originalVolume;
  }, [audioRef, mediaUrl, originalVolume, playbackRate]);

  useEffect(() => {
    const stemAudio = stemAudioRef.current;

    if (!stemAudio) {
      return;
    }

    stemAudio.playbackRate = playbackRate;
    stemAudio.volume = stemVolume;
  }, [playbackRate, stemAudioRef, stemMediaUrl, stemVolume]);

  useEffect(() => {
    const audio = audioRef.current;
    const stemAudio = stemAudioRef.current;

    if (!audio || !stemAudio || !isPlaying) {
      return;
    }

    stemAudio.currentTime = audio.currentTime;
    void stemAudio.play().catch(() => undefined);
  }, [audioRef, isPlaying, stemAudioRef, stemMediaUrl]);

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio || !isPlaying) {
      return undefined;
    }

    let frameId = 0;

    const update = () => {
      const stemAudio = stemAudioRef.current;
      const preferredClock = getMixerPlaybackClock({
        hasStem: Boolean(stemAudio),
        originalVolume,
        stemVolume
      });
      const useStemClock =
        preferredClock === "stem" &&
        stemAudio &&
        stemAudio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
      const clockAudio = useStemClock ? stemAudio : audio;
      const followerAudio = useStemClock ? audio : stemAudio;
      const followerVolume = useStemClock ? originalVolume : stemVolume;

      syncMediaTime(clockAudio.currentTime);
      if (
        followerAudio &&
        followerAudio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        shouldResyncMixerFollower({
          driftSeconds: followerAudio.currentTime - clockAudio.currentTime,
          followerVolume
        })
      ) {
        followerAudio.currentTime = clockAudio.currentTime;
      }

      frameId = requestAnimationFrame(update);
    };

    frameId = requestAnimationFrame(update);

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [
    audioRef,
    isPlaying,
    originalVolume,
    stemAudioRef,
    stemVolume,
    syncMediaTime
  ]);

  return (
    <>
      <audio
        ref={audioRef}
        aria-label="Original audio"
        preload="metadata"
        src={mediaUrl}
        onDurationChange={(event) => {
          syncMediaDuration(event.currentTarget.duration);
        }}
        onEnded={() => {
          stemAudioRef.current?.pause();
          markPaused();
        }}
        onLoadedMetadata={(event) => {
          syncMediaDuration(event.currentTarget.duration);
        }}
        onPause={() => {
          stemAudioRef.current?.pause();
          markPaused();
        }}
        onPlay={markPlaying}
        onTimeUpdate={(event) => {
          syncMediaTime(event.currentTarget.currentTime);
        }}
      />
      {stemMediaUrl ? (
        <audio
          ref={stemAudioRef}
          aria-label="Separated stem audio"
          preload="auto"
          src={stemMediaUrl}
          onLoadedMetadata={(event) => {
            const audio = audioRef.current;

            if (audio) {
              event.currentTarget.currentTime = audio.currentTime;
            }
          }}
        />
      ) : null}
    </>
  );
}
