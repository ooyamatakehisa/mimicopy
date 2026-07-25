import { useEffect, useRef, useState } from "react";
import type { Context } from "tone/build/esm/core/context/Context.js";
import type { PitchShift } from "tone/build/esm/effect/PitchShift.js";
import type { PlaybackState } from "./usePlaybackState";

export const pitchShiftWindowSeconds = 0.1;

type AudioContextConstructor = new (
  contextOptions?: AudioContextOptions
) => AudioContext;

type PitchShiftGraph = {
  connectSource: (
    source: MediaElementAudioSourceNode,
    destination: PitchShift
  ) => void;
  effect: PitchShift;
  originalSource: MediaElementAudioSourceNode;
  toneContext: Context;
};

function getAudioContextConstructor() {
  const audioWindow = window as typeof window & {
    webkitAudioContext?: AudioContextConstructor;
  };

  return window.AudioContext ?? audioWindow.webkitAudioContext ?? null;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error
    ? `転調用の音声処理を開始できませんでした: ${error.message}`
    : "転調用の音声処理を開始できませんでした。";
}

export function useAudioPitchShift({
  playback,
  semitones,
  stemMediaUrl
}: {
  playback: PlaybackState;
  semitones: number;
  stemMediaUrl: string | null;
}) {
  const graphRef = useRef<PitchShiftGraph | null>(null);
  const stemSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [pitchShiftErrorMessage, setPitchShiftErrorMessage] = useState<
    string | null
  >(null);
  const hasStem = Boolean(stemMediaUrl);

  useEffect(() => {
    const audio = playback.audioRef.current;
    const AudioContextCtor = getAudioContextConstructor();

    if (!audio || !AudioContextCtor) {
      return undefined;
    }

    let graph: PitchShiftGraph | null = null;
    let cancelled = false;
    let rawContext: AudioContext | null = null;
    let toneContext: Context | null = null;
    const initializeGraph = async () => {
      try {
        const [
          { connect },
          { Context: ToneContext },
          { PitchShift: TonePitchShift },
          { setContext }
        ] = await Promise.all([
          import("tone/build/esm/core/context/ToneAudioNode.js"),
          import("tone/build/esm/core/context/Context.js"),
          import("tone/build/esm/effect/PitchShift.js"),
          import("tone/build/esm/core/Global.js")
        ]);

        if (cancelled) {
          return;
        }

        rawContext = new AudioContextCtor({ latencyHint: "interactive" });
        toneContext = new ToneContext({
          context: rawContext,
          latencyHint: "interactive",
          lookAhead: 0
        });
        setContext(toneContext);
        const effect = new TonePitchShift({
          context: toneContext,
          delayTime: 0,
          feedback: 0,
          pitch: semitones,
          wet: semitones === 0 ? 0 : 1,
          windowSize: pitchShiftWindowSeconds
        }).toDestination();
        const originalSource = toneContext.createMediaElementSource(audio);

        connect(originalSource, effect);
        graph = {
          connectSource: (source, destination) => connect(source, destination),
          effect,
          originalSource,
          toneContext
        };
        graphRef.current = graph;
        playback.audioContextRef.current = rawContext;
        setAudioContext(rawContext);
        setPitchShiftErrorMessage(null);
      } catch (error) {
        if (!cancelled) {
          setPitchShiftErrorMessage(getErrorMessage(error));
        }
      }
    };

    void initializeGraph();

    return () => {
      cancelled = true;

      if (!graph) {
        if (toneContext) {
          void toneContext.close();
        } else if (rawContext) {
          void rawContext.close();
        }
        return;
      }

      stemSourceRef.current?.disconnect();
      stemSourceRef.current = null;
      graph.originalSource.disconnect();
      graph.effect.dispose();
      graphRef.current = null;

      if (playback.audioContextRef.current === graph.toneContext.rawContext) {
        playback.audioContextRef.current = null;
      }

      void graph.toneContext.close();
    };
  }, [playback.audioContextRef, playback.audioRef]);

  useEffect(() => {
    const graph = graphRef.current;

    if (!graph) {
      return;
    }

    graph.effect.pitch = semitones;
    graph.effect.wet.rampTo(semitones === 0 ? 0 : 1, 0.03);
  }, [audioContext, semitones]);

  useEffect(() => {
    const graph = graphRef.current;
    const stemAudio = playback.stemAudioRef.current;

    if (!graph || !hasStem || !stemAudio || stemSourceRef.current) {
      return undefined;
    }

    try {
      const stemSource =
        graph.toneContext.createMediaElementSource(stemAudio);

      graph.connectSource(stemSource, graph.effect);
      stemSourceRef.current = stemSource;
      setPitchShiftErrorMessage(null);
    } catch (error) {
      setPitchShiftErrorMessage(getErrorMessage(error));
    }

    return () => {
      stemSourceRef.current?.disconnect();
      stemSourceRef.current = null;
    };
  }, [audioContext, hasStem, playback.stemAudioRef]);

  useEffect(() => {
    if (semitones !== 0 && !getAudioContextConstructor()) {
      setPitchShiftErrorMessage(
        "このブラウザではリアルタイム転調を利用できません。"
      );
    }
  }, [semitones]);

  return {
    audioContext,
    pitchShiftErrorMessage
  };
}
