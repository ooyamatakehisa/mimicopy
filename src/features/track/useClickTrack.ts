import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BeatGrid, BeatPoint } from "../../lib/beats";
import type { PlaybackState } from "./usePlaybackState";

const LOOKAHEAD_SECONDS = 0.18;
const SCHEDULE_INTERVAL_MS = 45;
const SEEK_RESET_THRESHOLD_SECONDS = 0.35;

type AudioContextConstructor = new () => AudioContext;

type UseClickTrackOptions = {
  beatGrid: BeatGrid | null;
  playback: PlaybackState;
};

function getAudioContextConstructor() {
  const audioWindow = window as typeof window & {
    webkitAudioContext?: AudioContextConstructor;
  };

  return window.AudioContext ?? audioWindow.webkitAudioContext ?? null;
}

function getBeatKey(beat: BeatPoint) {
  return `${beat.time.toFixed(3)}:${beat.position}`;
}

function scheduleClick({
  audioContext,
  beat,
  startAt
}: {
  audioContext: AudioContext;
  beat: BeatPoint;
  startAt: number;
}) {
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const duration = beat.isDownbeat ? 0.075 : 0.045;
  const volume = beat.isDownbeat ? 0.14 : 0.075;

  oscillator.frequency.value = beat.isDownbeat ? 1760 : 1120;
  oscillator.type = "square";
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.01);
}

export function useClickTrack({ beatGrid, playback }: UseClickTrackOptions) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const lastMediaTimeRef = useRef(0);
  const scheduledBeatKeysRef = useRef(new Set<string>());
  const [isClickEnabled, setIsClickEnabled] = useState(false);
  const [clickErrorMessage, setClickErrorMessage] = useState<string | null>(
    null
  );
  const beats = beatGrid?.beats ?? [];
  const resetScheduledBeats = useCallback(() => {
    scheduledBeatKeysRef.current.clear();
    lastMediaTimeRef.current = playback.currentTime;
  }, [playback.currentTime]);
  const ensureAudioContext = useCallback(() => {
    if (audioContextRef.current) {
      return audioContextRef.current;
    }

    const AudioContextCtor = getAudioContextConstructor();

    if (!AudioContextCtor) {
      setClickErrorMessage("このブラウザではクリック音を生成できません。");
      return null;
    }

    audioContextRef.current = new AudioContextCtor();

    return audioContextRef.current;
  }, []);
  const toggleClickTrack = useCallback(() => {
    setClickErrorMessage(null);

    if (beats.length === 0) {
      setIsClickEnabled(false);
      return;
    }

    setIsClickEnabled((currentValue) => {
      const nextValue = !currentValue;

      if (nextValue) {
        void ensureAudioContext()?.resume().catch(() => {
          setClickErrorMessage("クリック音の再生を開始できませんでした。");
        });
      }

      return nextValue;
    });
  }, [beats.length, ensureAudioContext]);

  useEffect(() => {
    setIsClickEnabled(false);
    scheduledBeatKeysRef.current.clear();
  }, [beatGrid]);

  useEffect(() => {
    return () => {
      void audioContextRef.current?.close();
      audioContextRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!isClickEnabled || !playback.isPlaying || beats.length === 0) {
      return undefined;
    }

    const audio = playback.audioRef.current;
    const audioContext = ensureAudioContext();

    if (!audio || !audioContext) {
      return undefined;
    }

    void audioContext.resume().catch(() => {
      setClickErrorMessage("クリック音の再生を開始できませんでした。");
    });

    const scheduleVisibleBeats = () => {
      const currentTime = audio.currentTime;
      const lastTime = lastMediaTimeRef.current;

      if (
        currentTime < lastTime ||
        Math.abs(currentTime - lastTime) > SEEK_RESET_THRESHOLD_SECONDS
      ) {
        scheduledBeatKeysRef.current.clear();
      }

      lastMediaTimeRef.current = currentTime;

      for (const beat of beats) {
        if (
          beat.time < currentTime - 0.025 ||
          beat.time > currentTime + LOOKAHEAD_SECONDS
        ) {
          continue;
        }

        const beatKey = getBeatKey(beat);

        if (scheduledBeatKeysRef.current.has(beatKey)) {
          continue;
        }

        scheduledBeatKeysRef.current.add(beatKey);
        scheduleClick({
          audioContext,
          beat,
          startAt:
            audioContext.currentTime +
            Math.max(0, beat.time - currentTime) / playback.playbackRate
        });
      }
    };

    scheduleVisibleBeats();
    const intervalId = window.setInterval(
      scheduleVisibleBeats,
      SCHEDULE_INTERVAL_MS
    );

    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    beats,
    ensureAudioContext,
    isClickEnabled,
    playback.audioRef,
    playback.isPlaying,
    playback.playbackRate
  ]);

  return useMemo(
    () => ({
      clickErrorMessage,
      isClickEnabled,
      resetScheduledBeats,
      toggleClickTrack
    }),
    [
      clickErrorMessage,
      isClickEnabled,
      resetScheduledBeats,
      toggleClickTrack
    ]
  );
}

export type ClickTrackState = ReturnType<typeof useClickTrack>;
