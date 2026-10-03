import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateTrackDuration } from "../../lib/api";
import type { AudioProcessingControl } from "../../lib/audioProcessing";
import {
  clampTime,
  defaultPlaybackRate,
  nextPlaybackRate,
  seekBy,
  type PlaybackRate
} from "../../lib/playback";
import { cacheTrack } from "../../lib/trackQueryCache";

const mediaRestoreTimeoutMs = 15_000;
type PendingRestore = {
  audio: HTMLAudioElement;
  generation: number;
  target: number;
  phase: "metadata" | "seek";
  positionReady: boolean;
  processing: AudioProcessingControl | null;
  processingReady: boolean;
  timeout: number | null;
};
type PendingDrain = {
  audio: HTMLAudioElement;
  generation: number;
  startPosition: number;
  rate: number;
  startedAt: number;
  clock: AudioContext | null;
  timeout: number | null;
};

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function applyNativePlaybackRate(audio: HTMLMediaElement, rate: PlaybackRate) {
  audio.preservesPitch = false;
  if (audio.defaultPlaybackRate !== rate) audio.defaultPlaybackRate = rate;
  if (audio.playbackRate !== rate) audio.playbackRate = rate;
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
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioGraphReadyRef = useRef<Promise<void> | null>(null);
  const audioProcessingRef = useRef<AudioProcessingControl | null>(null);
  const playGenerationRef = useRef(0);
  const playRequestedRef = useRef(false);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const pendingRestoreRef = useRef<PendingRestore | null>(null);
  const pendingDrainRef = useRef<PendingDrain | null>(null);
  const audibleAnchorRef = useRef(0);
  const cursorRef = useRef(0);
  const needsReloadRef = useRef(false);
  const primedCursorRef = useRef<number | null>(null);
  const mediaPositionReadyRef = useRef(true);
  const activationRef = useRef<Promise<void>>(Promise.resolve());
  const [preparation, setPreparation] = useState<"paused" | "play" | null>(null);
  const [isStartingPlayback, setIsStartingPlayback] = useState(false);
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

  const publishTime = useCallback((time: number) => {
    cursorRef.current = time;
    setCurrentTime(time);
  }, []);

  const clearRestore = useCallback(() => {
    const pending = pendingRestoreRef.current;
    if (pending?.timeout !== null && pending?.timeout !== undefined) {
      window.clearTimeout(pending.timeout);
    }
    pendingRestoreRef.current = null;
  }, []);

  const clearDrain = useCallback(() => {
    const drain = pendingDrainRef.current;
    if (drain?.timeout !== null && drain?.timeout !== undefined) window.clearTimeout(drain.timeout);
    pendingDrainRef.current = null;
  }, []);

  const audiblePosition = useCallback((audio: HTMLAudioElement, nativeTime = audio.currentTime) => {
    const drain = pendingDrainRef.current;
    if (drain?.audio === audio) {
      const now = drain.clock ? drain.clock.currentTime : performance.now() / 1000;
      return clampTime(drain.startPosition + Math.max(0, now - drain.startedAt) * drain.rate, audio.duration);
    }
    const processing = audioProcessingRef.current;
    const latency = processing?.element === audio ? processing.latencySeconds : 0;
    return clampTime(Math.max(audibleAnchorRef.current, nativeTime - audio.playbackRate * latency), audio.duration);
  }, []);

  const silenceProcessing = useCallback((audio: HTMLMediaElement) => {
    const processing = audioProcessingRef.current;
    if (processing?.element === audio) processing.silence();
  }, []);

  const failPlayback = useCallback((audio: HTMLAudioElement, generation: number, error: unknown) => {
    if (generation !== playGenerationRef.current || audio !== activeAudioRef.current) return;
    ++playGenerationRef.current;
    playRequestedRef.current = false;
    clearRestore();
    clearDrain();
    setPreparation(null);
    silenceProcessing(audio);
    audio.pause();
    setIsPlaying(false);
    setIsStartingPlayback(false);
    setPlaybackError(getErrorMessage(error, "再生に失敗しました。"));
  }, [clearDrain, clearRestore, silenceProcessing]);

  const activateContext = useCallback((audio: HTMLAudioElement, generation: number) => {
    const context = audioContextRef.current;
    try {
      // Invoke resume in the trusted gesture, even when media restoration
      // still has to finish before play().
      const activation = context && context.state !== "running"
        ? context.resume() : Promise.resolve();
      activationRef.current = activation;
      void activation.catch((error: unknown) => failPlayback(audio, generation, error));
    } catch (error) {
      failPlayback(audio, generation, error);
    }
  }, [failPlayback]);

  const startNativePlayback = useCallback((audio: HTMLAudioElement, generation: number) => {
    if (generation !== playGenerationRef.current || !playRequestedRef.current ||
        audio !== activeAudioRef.current || !audioContextRef.current) return;
    primedCursorRef.current = null;
    needsReloadRef.current = true;
    audibleAnchorRef.current = audio.currentTime;
    setIsStartingPlayback(true);
    try {
      const processing = audioProcessingRef.current;
      if (processing?.element === audio) processing.open();
      const requests: Promise<unknown>[] = [activationRef.current, audio.play()];
      if (audioGraphReadyRef.current) requests.push(audioGraphReadyRef.current);
      void Promise.all(requests).catch((error: unknown) => failPlayback(audio, generation, error));
    } catch (error) {
      failPlayback(audio, generation, error);
    }
  }, [failPlayback]);

  const finishRestore = useCallback((pending: PendingRestore) => {
    if (pendingRestoreRef.current !== pending || pending.generation !== playGenerationRef.current ||
        !pending.positionReady || !pending.processingReady ||
        (pending.processing && audioProcessingRef.current !== pending.processing)) return;
    clearRestore();
    primedCursorRef.current = pending.target;
    mediaPositionReadyRef.current = true;
    publishTime(pending.target);
    setPreparation(null);
    if (Number.isFinite(pending.audio.duration) && pending.target >= pending.audio.duration) {
      // Seeking to the end should stop there; play() at an ended element
      // otherwise rewinds to zero and unexpectedly restarts the whole track.
      playRequestedRef.current = false;
      setIsPlaying(false);
      setIsStartingPlayback(false);
    } else if (playRequestedRef.current) {
      startNativePlayback(pending.audio, pending.generation);
    }
  }, [clearRestore, publishTime, startNativePlayback]);

  const restoreMetadata = useCallback((audio: HTMLAudioElement) => {
    const pending = pendingRestoreRef.current;
    if (!pending || pending.audio !== audio || pending.phase !== "metadata" || audio.readyState < 1) return;
    pending.phase = "seek";
    pending.target = clampTime(pending.target, audio.duration);
    try {
      audio.currentTime = pending.target;
      // A zero/no-op seek need not dispatch seeked. Otherwise wait for the
      // actual decoder seek, never a timer, before replaying this element.
      if (!audio.seeking && Math.abs(audio.currentTime - pending.target) < 0.01) {
        pending.positionReady = true;
        finishRestore(pending);
      }
    } catch (error) {
      failPlayback(audio, pending.generation, error);
    }
  }, [failPlayback, finishRestore]);

  const restoreSeeked = useCallback((audio: HTMLAudioElement) => {
    const pending = pendingRestoreRef.current;
    if (pending) {
      if (pending.audio === audio && pending.phase === "seek" && !audio.seeking &&
          Math.abs(audio.currentTime - pending.target) < 0.05) {
        pending.positionReady = true;
        finishRestore(pending);
      }
      return;
    }
    if (audio === activeAudioRef.current && mediaPositionReadyRef.current) publishTime(audio.currentTime);
  }, [finishRestore, publishTime]);

  const beginRestore = useCallback((
    audio: HTMLAudioElement, target: number, wantsPlay: boolean, reload: boolean, rate?: PlaybackRate
  ) => {
    clearDrain();
    clearRestore();
    const generation = ++playGenerationRef.current;
    playRequestedRef.current = wantsPlay;
    primedCursorRef.current = null;
    needsReloadRef.current = true;
    mediaPositionReadyRef.current = false;
    const control = audioProcessingRef.current;
    const processing = control?.element === audio ? control : null;
    const pending: PendingRestore = {
      audio, generation, target, phase: "metadata", positionReady: false,
      processing, processingReady: processing === null, timeout: null
    };
    pendingRestoreRef.current = pending;
    publishTime(target);
    setIsPlaying(false);
    setIsStartingPlayback(false);
    setPreparation(wantsPlay ? "play" : "paused");
    setPlaybackError(null);
    pending.timeout = window.setTimeout(() => {
      if (pendingRestoreRef.current === pending) {
        failPlayback(audio, pending.generation, new Error("再生位置を準備できませんでした。もう一度再生してください。"));
      }
    }, mediaRestoreTimeoutMs);
    if (wantsPlay) activateContext(audio, generation);
    if (pendingRestoreRef.current !== pending) return;
    try {
      silenceProcessing(audio);
      audio.pause();
      // A native rate change while playing can produce its own decoder gap.
      // Pause first and prepare both the transport and DSP at the new rate.
      if (rate !== undefined) applyNativePlaybackRate(audio, rate);
      // Reset WebKit's native decoded PCM queue. Changing currentTime alone
      // can replay stale common audio even with a single transport.
      if (reload) audio.load();
      if (processing) {
        void processing.prepare().then(() => {
          if (pendingRestoreRef.current !== pending || audioProcessingRef.current !== processing) return;
          pending.processingReady = true;
          finishRestore(pending);
        }).catch((error: unknown) => {
          // Graph failure clears its shared control ref before rejecting.
          // The pending operation still owns this failure; an older operation
          // is excluded by its pending identity and transport generation.
          if (pendingRestoreRef.current === pending) {
            failPlayback(audio, pending.generation, error);
          }
        });
      }
      restoreMetadata(audio);
    } catch (error) {
      failPlayback(audio, generation, error);
    }
  }, [activateContext, clearDrain, clearRestore, failPlayback, finishRestore, publishTime, restoreMetadata, silenceProcessing]);

  const bindAudio = useCallback((audio: HTMLAudioElement) => {
    activeAudioRef.current = audio;
    audibleAnchorRef.current = cursorRef.current;
    playRequestedRef.current = false;
    needsReloadRef.current = false;
    primedCursorRef.current = null;
    mediaPositionReadyRef.current = true;
    setIsPlaying(false);
    setIsStartingPlayback(false);
    setPlaybackError(null);
    if (cursorRef.current > 0) beginRestore(audio, cursorRef.current, false, false);
    return () => {
      // Capture this exact element: React clears/replaces audioRef before
      // passive cleanup, and a detached element can otherwise keep playing.
      if (activeAudioRef.current === audio) {
        ++playGenerationRef.current;
        playRequestedRef.current = false;
        clearRestore();
        clearDrain();
        activeAudioRef.current = null;
        mediaPositionReadyRef.current = false;
        setPreparation(null);
      }
      silenceProcessing(audio);
      audio.pause();
    };
  }, [beginRestore, clearDrain, clearRestore, silenceProcessing]);

  const seekTo = useCallback((time: number) => {
    const target = clampTime(time, duration);
    const audio = audioRef.current;
    if (audio) beginRestore(audio, target, playRequestedRef.current, true);
    else publishTime(target);
  }, [beginRestore, duration, publishTime]);

  const seekBySeconds = useCallback((deltaSeconds: number) => {
    seekTo(seekBy(cursorRef.current, deltaSeconds, duration));
  }, [duration, seekTo]);

  const togglePlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !audioContextRef.current) return;
    const pending = pendingRestoreRef.current;
    if (playRequestedRef.current || !audio.paused) {
      if (pending) {
        pending.generation = ++playGenerationRef.current;
        playRequestedRef.current = false;
        setPreparation("paused");
        silenceProcessing(audio);
        audio.pause();
        setIsPlaying(false);
        setIsStartingPlayback(false);
      } else {
        beginRestore(audio, audiblePosition(audio), false, true);
      }
      return;
    }
    setPlaybackError(null);
    if (pending) {
      pending.generation = ++playGenerationRef.current;
      playRequestedRef.current = true;
      setPreparation("play");
      activateContext(audio, pending.generation);
      return;
    }
    const target = audio.ended ? 0 : cursorRef.current;
    if (needsReloadRef.current && primedCursorRef.current === null) {
      beginRestore(audio, target, true, true);
      return;
    }
    const generation = ++playGenerationRef.current;
    playRequestedRef.current = true;
    activateContext(audio, generation);
    startNativePlayback(audio, generation);
  }, [activateContext, audiblePosition, beginRestore, silenceProcessing, startNativePlayback]);

  const syncPlaybackRate = useCallback((rate: PlaybackRate) => {
    const audio = audioRef.current;
    if (!audio) return;
    const processing = audioProcessingRef.current;
    const changed = audio.playbackRate !== rate || audio.defaultPlaybackRate !== rate;
    if (changed && processing?.element === audio) {
      const target = pendingRestoreRef.current || !mediaPositionReadyRef.current
        ? cursorRef.current : playRequestedRef.current || !audio.paused
          ? audiblePosition(audio) : audio.currentTime;
      beginRestore(audio, target, playRequestedRef.current, true, rate);
    } else {
      // Initial graph setup reads these properties before enabling Play.
      applyNativePlaybackRate(audio, rate);
    }
  }, [audiblePosition, beginRestore]);

  const selectPlaybackRate = useCallback((rate: PlaybackRate) => {
    setPlaybackRate(rate);
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
    if (pendingRestoreRef.current || !mediaPositionReadyRef.current) return;
    const audio = audioRef.current;
    publishTime(audio && (playRequestedRef.current || !audio.paused || pendingDrainRef.current)
      ? audiblePosition(audio, nextTime) : nextTime);
  }, [audiblePosition, publishTime]);

  const markPlaying = useCallback(() => {
    if (pendingRestoreRef.current || !playRequestedRef.current || audioRef.current?.paused) return;
    setIsPlaying(true);
    setIsStartingPlayback(false);
  }, []);

  const markPaused = useCallback(() => {
    // load()/pause() events during restoration must not cancel queued Play.
    if (pendingRestoreRef.current) return;
    // A queued pause event can arrive after a newer play request.
    if (audioRef.current && !audioRef.current.paused && !audioRef.current.ended) return;
    const audio = audioRef.current;
    // Natural end must drain the processor's remaining output. Explicit UI
    // pauses have already closed the gate before pausing the native element.
    if (audio?.ended) return;
    if (audio) silenceProcessing(audio);
    ++playGenerationRef.current;
    playRequestedRef.current = false;
    setIsPlaying(false);
    setIsStartingPlayback(false);
  }, [silenceProcessing]);

  const markEnded = useCallback(() => {
    const audio = audioRef.current;
    if (pendingRestoreRef.current || !audio?.ended || pendingDrainRef.current?.audio === audio) return;
    const generation = ++playGenerationRef.current;
    needsReloadRef.current = true;
    primedCursorRef.current = null;
    setIsStartingPlayback(false);
    const startPosition = audiblePosition(audio);
    const context = audioContextRef.current;
    const clock = context && Number.isFinite(context.currentTime) ? context : null;
    const drain: PendingDrain = {
      audio, generation, startPosition, rate: audio.playbackRate, clock,
      startedAt: clock ? clock.currentTime : performance.now() / 1000, timeout: null
    };
    pendingDrainRef.current = drain;
    playRequestedRef.current = true;
    setIsPlaying(true);
    publishTime(startPosition);
    const finishDrain = () => {
      if (pendingDrainRef.current !== drain || generation !== playGenerationRef.current ||
          audio !== activeAudioRef.current) return;
      const remainingSeconds = Math.max(0, audio.duration - audiblePosition(audio)) / drain.rate;
      if (remainingSeconds > 0.001) {
        drain.timeout = window.setTimeout(finishDrain, remainingSeconds * 1000);
        return;
      }
      clearDrain();
      playRequestedRef.current = false;
      publishTime(audio.duration);
      setIsPlaying(false);
    };
    // Keep click scheduling, the output gate, and the context alive for the
    // remaining processed tail. An explicit action cancels this generation.
    finishDrain();
  }, [audiblePosition, clearDrain, publishTime]);

  const reportMediaError = useCallback((label: string) => {
    const audio = audioRef.current;
    if (audio) failPlayback(audio, playGenerationRef.current,
      new Error(`${label}を読み込めませんでした。再読み込みしてお試しください。`));
  }, [failPlayback]);

  useEffect(() => {
    return () => {
      ++playGenerationRef.current;
      playRequestedRef.current = false;
      clearRestore();
      clearDrain();
      const audio = activeAudioRef.current;
      if (audio) silenceProcessing(audio);
      // PlaybackAudio owns pausing each actual element, including replacements.
    };
  }, [clearDrain, clearRestore, silenceProcessing]);

  return useMemo(
    () => ({
      audioContextRef,
      audioGraphReadyRef,
      audioProcessingRef,
      audioRef,
      bindAudio,
      restoreMetadata,
      restoreSeeked,
      isPreparing: preparation !== null || isStartingPlayback,
      isPlayPending: preparation === "play" || isStartingPlayback,
      changePlaybackRate,
      selectPlaybackRate,
      currentTime,
      duration,
      durationErrorMessage,
      isPlaying,
      markPaused,
      markEnded,
      markPlaying,
      playbackError,
      playbackRate,
      reportMediaError,
      seekBySeconds,
      seekTo,
      syncMediaDuration,
      syncMediaTime,
      syncPlaybackRate,
      togglePlayback
    }),
    [
      bindAudio,
      restoreMetadata,
      restoreSeeked,
      preparation,
      isStartingPlayback,
      changePlaybackRate,
      selectPlaybackRate,
      currentTime,
      duration,
      durationErrorMessage,
      isPlaying,
      markPaused,
      markEnded,
      markPlaying,
      playbackError,
      playbackRate,
      reportMediaError,
      seekBySeconds,
      seekTo,
      syncMediaDuration,
      syncMediaTime,
      syncPlaybackRate,
      togglePlayback
    ]
  );
}

export type PlaybackState = ReturnType<typeof usePlaybackState>;
