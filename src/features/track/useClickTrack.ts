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

  return oscillator;
}

export function useClickTrack({ beatGrid, playback }: UseClickTrackOptions) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const lastMediaTimeRef = useRef(0);
  const scheduledBeatKeysRef = useRef(new Set<string>());
  const scheduledOscillatorsRef = useRef(new Map<string, OscillatorNode>());
  const [isClickEnabled, setIsClickEnabled] = useState(false);
  const [clickErrorMessage, setClickErrorMessage] = useState<string | null>(
    null
  );
  const beats = beatGrid?.beats ?? [];
  const cancelScheduledClicks = useCallback(() => {
    for (const [beatKey, oscillator] of scheduledOscillatorsRef.current) {
      oscillator.onended = null;

      try {
        oscillator.stop();
      } catch {
        // The oscillator may already have ended between scheduler ticks.
      }

      scheduledBeatKeysRef.current.delete(beatKey);
    }

    scheduledOscillatorsRef.current.clear();
  }, []);
  const resetScheduledBeats = useCallback(() => {
    cancelScheduledClicks();
    scheduledBeatKeysRef.current.clear();
    lastMediaTimeRef.current = playback.currentTime;
  }, [cancelScheduledClicks, playback.currentTime]);
  const ensureAudioContext = useCallback(() => {
    const audio = playback.audioRef.current;

    if (!audio) {
      return null;
    }

    let audioContext = audioContextRef.current;

    if (!audioContext) {
      const AudioContextCtor = getAudioContextConstructor();

      if (!AudioContextCtor) {
        setClickErrorMessage("このブラウザではクリック音を生成できません。");
        return null;
      }

      audioContext = new AudioContextCtor();
      audioContextRef.current = audioContext;
    }

    if (!mediaSourceRef.current) {
      try {
        const mediaSource = audioContext.createMediaElementSource(audio);

        mediaSource.connect(audioContext.destination);
        mediaSourceRef.current = mediaSource;
      } catch {
        setClickErrorMessage("曲とクリック音を同期できませんでした。");
        return null;
      }
    }

    return audioContext;
  }, [playback.audioRef]);
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
    cancelScheduledClicks();
    scheduledBeatKeysRef.current.clear();
  }, [beatGrid, cancelScheduledClicks]);

  useEffect(() => {
    return () => {
      cancelScheduledClicks();
      mediaSourceRef.current?.disconnect();
      mediaSourceRef.current = null;
      void audioContextRef.current?.close();
      audioContextRef.current = null;
    };
  }, [cancelScheduledClicks]);

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
        cancelScheduledClicks();
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
        const oscillator = scheduleClick({
          audioContext,
          beat,
          startAt:
            audioContext.currentTime +
            Math.max(0, beat.time - currentTime) / playback.playbackRate
        });
        scheduledOscillatorsRef.current.set(beatKey, oscillator);
        oscillator.onended = () => {
          scheduledOscillatorsRef.current.delete(beatKey);
        };
      }
    };

    scheduleVisibleBeats();
    const intervalId = window.setInterval(
      scheduleVisibleBeats,
      SCHEDULE_INTERVAL_MS
    );

    return () => {
      window.clearInterval(intervalId);
      cancelScheduledClicks();
    };
  }, [
    beats,
    cancelScheduledClicks,
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
