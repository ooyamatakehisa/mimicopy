import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createAudioPlaybackGraph,
  destroyAudioPlaybackGraph,
  restartAudioPlaybackGraph,
  setAudioPlaybackGraphSemitones,
  setAudioPlaybackGraphVolumes,
  stopAudioPlaybackGraph,
  type AudioPlaybackGraph,
  type PlaybackAudioBuffers
} from "../../lib/audioEngine";
import type { MixerVolumes } from "../../lib/audioMixer";
import {
  getContextTimeForMediaTime,
  getTransportMediaTime,
  type TransportAnchor
} from "../../lib/audioTransport";
import { getPlaybackAudioContext } from "../../lib/audio";
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
  audioBuffers,
  initialDuration,
  mixerVolumes,
  semitones,
  trackDuration,
  trackId
}: {
  audioBuffers: PlaybackAudioBuffers;
  initialDuration: number;
  mixerVolumes: MixerVolumes;
  semitones: number;
  trackDuration: number;
  trackId: string;
}) {
  const audioContext = getPlaybackAudioContext();
  const graphRef = useRef<AudioPlaybackGraph | null>(null);
  const anchorRef = useRef<TransportAnchor | null>(null);
  const currentTimeRef = useRef(0);
  const durationRef = useRef(initialDuration);
  const isPlayingRef = useRef(false);
  const playbackRateRef = useRef<PlaybackRate>(defaultPlaybackRate);
  const playRequestRef = useRef<Promise<void> | null>(null);
  const semitonesRef = useRef(semitones);
  const mixerVolumesRef = useRef(mixerVolumes);
  const queryClient = useQueryClient();
  const savedDurationRef = useRef(trackDuration);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [duration] = useState(initialDuration);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [playbackRate, setPlaybackRate] =
    useState<PlaybackRate>(defaultPlaybackRate);
  const { error: durationError, mutate: saveDuration } = useMutation({
    mutationFn: updateTrackDuration,
    onSuccess: (updatedTrack) => {
      cacheTrack(queryClient, updatedTrack);
    }
  });

  durationRef.current = duration;
  mixerVolumesRef.current = mixerVolumes;
  semitonesRef.current = semitones;

  const durationErrorMessage = durationError
    ? getErrorMessage(durationError, "曲の長さを保存できませんでした。")
    : null;

  const saveDecodedDuration = useCallback(() => {
    if (
      Math.abs(duration - trackDuration) <= 0.25 ||
      Math.abs(duration - savedDurationRef.current) <= 0.25
    ) {
      return;
    }

    savedDurationRef.current = duration;
    saveDuration({ duration, trackId });
  }, [duration, saveDuration, trackDuration, trackId]);

  const getCurrentTime = useCallback(() => {
    const anchor = anchorRef.current;

    if (!anchor) {
      return currentTimeRef.current;
    }

    return getTransportMediaTime({
      anchor,
      contextTime: audioContext.currentTime,
      duration: durationRef.current
    });
  }, [audioContext]);

  const commitCurrentTime = useCallback((nextTime: number) => {
    currentTimeRef.current = nextTime;
    setCurrentTime(nextTime);
  }, []);

  const stopPlayback = useCallback(
    (nextTime = getCurrentTime()) => {
      const graph = graphRef.current;

      if (graph) {
        stopAudioPlaybackGraph(graph);
      }

      anchorRef.current = null;
      isPlayingRef.current = false;
      setIsPlaying(false);
      commitCurrentTime(nextTime);
    },
    [commitCurrentTime, getCurrentTime]
  );

  const restartPlayingSources = useCallback(
    (mediaTime: number, nextPlaybackRate = playbackRateRef.current) => {
      const graph = graphRef.current;

      if (!graph) {
        return false;
      }

      try {
        const contextTime = restartAudioPlaybackGraph({
          audioBuffers,
          graph,
          mediaTime,
          playbackRate: nextPlaybackRate,
          semitones: semitonesRef.current
        });

        anchorRef.current = {
          contextTime,
          mediaTime,
          playbackRate: nextPlaybackRate
        };
        commitCurrentTime(mediaTime);
        setPlaybackError(null);

        return true;
      } catch (error) {
        stopPlayback(mediaTime);
        setPlaybackError(
          getErrorMessage(error, "音声の再生を開始できませんでした。")
        );

        return false;
      }
    },
    [audioBuffers, commitCurrentTime, stopPlayback]
  );

  const seekTo = useCallback(
    (time: number) => {
      const nextTime = clampTime(time, durationRef.current);

      saveDecodedDuration();

      if (isPlayingRef.current && nextTime < durationRef.current) {
        restartPlayingSources(nextTime);
        return;
      }

      if (isPlayingRef.current) {
        stopPlayback(nextTime);
        return;
      }

      commitCurrentTime(nextTime);
    },
    [
      commitCurrentTime,
      restartPlayingSources,
      saveDecodedDuration,
      stopPlayback
    ]
  );

  const seekBySeconds = useCallback(
    (deltaSeconds: number) => {
      seekTo(seekBy(getCurrentTime(), deltaSeconds, durationRef.current));
    },
    [getCurrentTime, seekTo]
  );

  const startPlayback = useCallback(async () => {
    const graph = graphRef.current;

    if (!graph) {
      setPlaybackError("音声エンジンを準備しています。");
      return;
    }

    saveDecodedDuration();

    if (audioContext.state !== "running") {
      await audioContext.resume();
    }

    if (graphRef.current !== graph || isPlayingRef.current) {
      return;
    }

    const startTime =
      currentTimeRef.current >= durationRef.current
        ? 0
        : currentTimeRef.current;

    if (restartPlayingSources(startTime)) {
      isPlayingRef.current = true;
      setIsPlaying(true);
    }
  }, [
    audioContext,
    restartPlayingSources,
    saveDecodedDuration
  ]);

  const togglePlayback = useCallback(() => {
    if (isPlayingRef.current) {
      stopPlayback();
      return;
    }

    if (playRequestRef.current) {
      return;
    }

    const playRequest = startPlayback()
      .catch((error: unknown) => {
        setPlaybackError(
          getErrorMessage(error, "音声の再生を開始できませんでした。")
        );
      })
      .finally(() => {
        if (playRequestRef.current === playRequest) {
          playRequestRef.current = null;
        }
      });

    playRequestRef.current = playRequest;
  }, [startPlayback, stopPlayback]);

  const changePlaybackRate = useCallback(
    (direction: "faster" | "slower") => {
      const mediaTime = getCurrentTime();
      const nextRate = nextPlaybackRate(playbackRateRef.current, direction);

      playbackRateRef.current = nextRate;
      setPlaybackRate(nextRate);

      if (isPlayingRef.current) {
        restartPlayingSources(mediaTime, nextRate);
      }
    },
    [getCurrentTime, restartPlayingSources]
  );

  const getContextTimeForTrackTime = useCallback((mediaTime: number) => {
    return getContextTimeForMediaTime(anchorRef.current, mediaTime);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let graph: AudioPlaybackGraph | null = null;

    setIsReady(false);

    void createAudioPlaybackGraph(audioContext, mixerVolumesRef.current)
      .then((nextGraph) => {
        if (cancelled) {
          destroyAudioPlaybackGraph(nextGraph);
          return;
        }

        graph = nextGraph;
        graphRef.current = graph;
        setPlaybackError(null);
        setIsReady(true);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setPlaybackError(
            getErrorMessage(error, "音声エンジンを準備できませんでした。")
          );
        }
      });

    return () => {
      cancelled = true;

      if (!graph) {
        return;
      }

      destroyAudioPlaybackGraph(graph);

      if (graphRef.current === graph) {
        graphRef.current = null;
      }
    };
  }, [
    audioBuffers.original,
    audioBuffers.remainder,
    audioBuffers.stem,
    audioContext
  ]);

  useEffect(() => {
    const graph = graphRef.current;

    if (!graph) {
      return;
    }

    setAudioPlaybackGraphVolumes(graph, mixerVolumes);
  }, [
    audioContext,
    mixerVolumes.original,
    mixerVolumes.remainder,
    mixerVolumes.stem
  ]);

  useEffect(() => {
    const graph = graphRef.current;

    if (graph) {
      setAudioPlaybackGraphSemitones(graph, semitones);
    }
  }, [semitones]);

  useEffect(() => {
    if (!isPlaying) {
      return undefined;
    }

    let frameId = 0;
    const update = () => {
      const nextTime = getCurrentTime();

      if (nextTime >= durationRef.current) {
        stopPlayback(durationRef.current);
        return;
      }

      commitCurrentTime(nextTime);
      frameId = requestAnimationFrame(update);
    };

    frameId = requestAnimationFrame(update);

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [commitCurrentTime, getCurrentTime, isPlaying, stopPlayback]);

  return useMemo(
    () => ({
      audioContext,
      changePlaybackRate,
      currentTime,
      duration,
      durationErrorMessage,
      getContextTimeForTrackTime,
      getCurrentTime,
      isPlaying,
      isReady,
      playbackError,
      playbackRate,
      seekBySeconds,
      seekTo,
      togglePlayback
    }),
    [
      audioContext,
      changePlaybackRate,
      currentTime,
      duration,
      durationErrorMessage,
      getContextTimeForTrackTime,
      getCurrentTime,
      isPlaying,
      isReady,
      playbackError,
      playbackRate,
      seekBySeconds,
      seekTo,
      togglePlayback
    ]
  );
}

export type PlaybackState = ReturnType<typeof usePlaybackState>;
