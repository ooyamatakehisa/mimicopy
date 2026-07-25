import { useCallback, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateTrackDuration } from "../../lib/api";
import {
  clampTime,
  defaultPlaybackRate,
  nextPlaybackRate,
  seekBy,
  type PlaybackRate
} from "../../lib/playback";
import { cacheTrack } from "../../lib/trackQueryCache";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function usePlaybackState({
  initialDuration,
  trackDuration,
  trackId
}: {
  initialDuration: number;
  trackDuration: number;
  trackId: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const remainderAudioRef = useRef<HTMLAudioElement>(null);
  const stemAudioRef = useRef<HTMLAudioElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const queryClient = useQueryClient();
  const savedDurationRef = useRef(trackDuration);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [duration, setDuration] = useState(initialDuration);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] =
    useState<PlaybackRate>(defaultPlaybackRate);
  const { error: durationError, mutate: saveDuration } = useMutation({
    mutationFn: updateTrackDuration,
    onSuccess: (updatedTrack) => {
      cacheTrack(queryClient, updatedTrack);
    }
  });

  const durationErrorMessage = durationError
    ? getErrorMessage(durationError, "曲の長さを保存できませんでした。")
    : null;

  const seekTo = useCallback(
    (time: number) => {
      const nextTime = clampTime(time, duration);
      const audio = audioRef.current;

      if (audio) {
        audio.currentTime = nextTime;
      }
      if (stemAudioRef.current) {
        stemAudioRef.current.currentTime = nextTime;
      }
      if (remainderAudioRef.current) {
        remainderAudioRef.current.currentTime = nextTime;
      }

      setCurrentTime(nextTime);
    },
    [duration]
  );

  const seekBySeconds = useCallback(
    (deltaSeconds: number) => {
      seekTo(seekBy(currentTime, deltaSeconds, duration));
    },
    [currentTime, duration, seekTo]
  );

  const togglePlayback = useCallback(() => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    if (audio.paused) {
      const stemAudio = stemAudioRef.current;
      const remainderAudio = remainderAudioRef.current;

      if (stemAudio) {
        stemAudio.currentTime = audio.currentTime;
      }
      if (remainderAudio) {
        remainderAudio.currentTime = audio.currentTime;
      }

      const playRequests: Promise<unknown>[] = [audio.play()];

      if (stemAudio) {
        playRequests.push(stemAudio.play());
      }
      if (remainderAudio) {
        playRequests.push(remainderAudio.play());
      }
      if (audioContextRef.current?.state === "suspended") {
        playRequests.push(audioContextRef.current.resume());
      }

      void Promise.all(playRequests).catch((error: unknown) => {
        audio.pause();
        stemAudio?.pause();
        remainderAudio?.pause();
        setPlaybackError(getErrorMessage(error, "再生に失敗しました。"));
      });
      return;
    }

    audio.pause();
    stemAudioRef.current?.pause();
    remainderAudioRef.current?.pause();
  }, []);

  const changePlaybackRate = useCallback(
    (direction: "faster" | "slower") => {
      setPlaybackRate((currentRate) => nextPlaybackRate(currentRate, direction));
    },
    []
  );

  const syncMediaDuration = useCallback(
    (nextDuration: number) => {
      if (!Number.isFinite(nextDuration) || nextDuration <= 0) {
        return;
      }

      setDuration(nextDuration);

      if (
        Math.abs(nextDuration - trackDuration) > 0.25 &&
        Math.abs(nextDuration - savedDurationRef.current) > 0.25
      ) {
        savedDurationRef.current = nextDuration;
        saveDuration({ duration: nextDuration, trackId });
      }
    },
    [saveDuration, trackDuration, trackId]
  );

  const syncMediaTime = useCallback((nextTime: number) => {
    setCurrentTime(nextTime);
  }, []);

  const markPlaying = useCallback(() => {
    setPlaybackError(null);
    setIsPlaying(true);
  }, []);

  const markPaused = useCallback(() => {
    setIsPlaying(false);
  }, []);

  return useMemo(
    () => ({
      audioContextRef,
      audioRef,
      changePlaybackRate,
      currentTime,
      duration,
      durationErrorMessage,
      isPlaying,
      markPaused,
      markPlaying,
      playbackError,
      playbackRate,
      remainderAudioRef,
      seekBySeconds,
      seekTo,
      stemAudioRef,
      syncMediaDuration,
      syncMediaTime,
      togglePlayback
    }),
    [
      changePlaybackRate,
      currentTime,
      duration,
      durationErrorMessage,
      isPlaying,
      markPaused,
      markPlaying,
      playbackError,
      playbackRate,
      remainderAudioRef,
      seekBySeconds,
      seekTo,
      stemAudioRef,
      syncMediaDuration,
      syncMediaTime,
      togglePlayback
    ]
  );
}

export type PlaybackState = ReturnType<typeof usePlaybackState>;
