import { useEffect } from "react";
import {
  getMixerFollowerPlaybackRate,
  getMixerPlaybackClock,
  shouldHardSyncMixerFollower
} from "../../lib/mixer";
import type { PlaybackState } from "./usePlaybackState";

type PlaybackAudioProps = {
  mediaUrl: string;
  originalVolume: number;
  playback: PlaybackState;
  remainderMediaUrl: string | null;
  remainderVolume: number;
  stemMediaUrl: string | null;
  stemVolume: number;
};

export function PlaybackAudio({
  mediaUrl,
  originalVolume,
  playback,
  remainderMediaUrl,
  remainderVolume,
  stemMediaUrl,
  stemVolume
}: PlaybackAudioProps) {
  const {
    audioRef,
    isPlaying,
    markPaused,
    markPlaying,
    playbackRate,
    remainderAudioRef,
    stemAudioRef,
    syncMediaDuration,
    syncMediaTime
  } = playback;

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    audio.preservesPitch = true;
    audio.playbackRate = playbackRate;
    audio.volume = originalVolume;
  }, [audioRef, mediaUrl, originalVolume, playbackRate]);

  useEffect(() => {
    const stemAudio = stemAudioRef.current;

    if (!stemAudio) {
      return;
    }

    stemAudio.preservesPitch = true;
    stemAudio.playbackRate = playbackRate;
    stemAudio.volume = stemVolume;
  }, [playbackRate, stemAudioRef, stemMediaUrl, stemVolume]);

  useEffect(() => {
    const remainderAudio = remainderAudioRef.current;

    if (!remainderAudio) {
      return;
    }

    remainderAudio.preservesPitch = true;
    remainderAudio.playbackRate = playbackRate;
    remainderAudio.volume = remainderVolume;
  }, [
    playbackRate,
    remainderAudioRef,
    remainderMediaUrl,
    remainderVolume
  ]);

  useEffect(() => {
    const audio = audioRef.current;
    const auxiliaryAudio = [
      stemAudioRef.current,
      remainderAudioRef.current
    ].filter(
      (candidate): candidate is HTMLAudioElement => Boolean(candidate)
    );

    if (!audio || auxiliaryAudio.length === 0 || !isPlaying) {
      return;
    }

    for (const auxiliary of auxiliaryAudio) {
      auxiliary.currentTime = audio.currentTime;
      void auxiliary.play().catch(() => undefined);
    }
  }, [
    audioRef,
    isPlaying,
    remainderAudioRef,
    remainderMediaUrl,
    stemAudioRef,
    stemMediaUrl
  ]);

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio || !isPlaying) {
      return undefined;
    }

    let frameId = 0;

    const update = () => {
      const stemAudio = stemAudioRef.current;
      const remainderAudio = remainderAudioRef.current;
      const preferredClock = getMixerPlaybackClock({
        hasRemainder: Boolean(remainderAudio),
        hasStem: Boolean(stemAudio),
        originalVolume,
        remainderVolume,
        stemVolume
      });
      const candidates = {
        original: audio,
        remainder: remainderAudio,
        stem: stemAudio
      };
      const preferredAudio = candidates[preferredClock];
      const clockAudio =
        preferredAudio &&
        preferredAudio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
          ? preferredAudio
          : audio;
      const followers = [
        { audio, volume: originalVolume },
        { audio: stemAudio, volume: stemVolume },
        { audio: remainderAudio, volume: remainderVolume }
      ];

      if (clockAudio.playbackRate !== playbackRate) {
        clockAudio.playbackRate = playbackRate;
      }
      syncMediaTime(clockAudio.currentTime);
      for (const follower of followers) {
        if (
          follower.audio &&
          follower.audio !== clockAudio &&
          follower.audio.readyState >=
            HTMLMediaElement.HAVE_CURRENT_DATA
        ) {
          const driftSeconds =
            follower.audio.currentTime - clockAudio.currentTime;

          if (
            shouldHardSyncMixerFollower({
              driftSeconds,
              followerVolume: follower.volume
            })
          ) {
            follower.audio.currentTime = clockAudio.currentTime;
          }

          const correctedPlaybackRate =
            getMixerFollowerPlaybackRate({
              basePlaybackRate: playbackRate,
              currentPlaybackRate: follower.audio.playbackRate,
              driftSeconds,
              followerVolume: follower.volume
            });

          if (follower.audio.playbackRate !== correctedPlaybackRate) {
            follower.audio.playbackRate = correctedPlaybackRate;
          }
        }
      }

      frameId = requestAnimationFrame(update);
    };

    frameId = requestAnimationFrame(update);

    return () => {
      cancelAnimationFrame(frameId);

      for (const mediaElement of [
        audio,
        stemAudioRef.current,
        remainderAudioRef.current
      ]) {
        if (mediaElement) {
          mediaElement.playbackRate = playbackRate;
        }
      }
    };
  }, [
    audioRef,
    isPlaying,
    originalVolume,
    playbackRate,
    remainderAudioRef,
    remainderVolume,
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
          remainderAudioRef.current?.pause();
          markPaused();
        }}
        onLoadedMetadata={(event) => {
          syncMediaDuration(event.currentTarget.duration);
        }}
        onPause={() => {
          stemAudioRef.current?.pause();
          remainderAudioRef.current?.pause();
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
      {remainderMediaUrl ? (
        <audio
          ref={remainderAudioRef}
          aria-label="Separated remainder audio"
          preload="auto"
          src={remainderMediaUrl}
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
