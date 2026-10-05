import { useCallback, useEffect, useRef, useState } from "react";
import {
  configurePlaybackAudioSession,
  type AudioSessionNavigator
} from "../../lib/audioSession";
import { clampMixerVolume, getMixerGainAtTime, type MixerChannelId, type MixerGainRamp } from "../../lib/mixer";
import type { ClickCueProcessor } from "../../lib/clickCueProcessor";
import type { PitchProcessor } from "../../lib/pitchProcessor";
import type { AudioProcessingControl } from "../../lib/audioProcessing";
import type { PlaybackState } from "./usePlaybackState";

const channelGainRampSeconds = 0.008;
const channelGainLeadSeconds = 0.01;
const graphInitializationTimeoutMs = 15_000;

type AudioContextConstructor = new (contextOptions?: AudioContextOptions) => AudioContext;
type AudioChannel = {
  gain: GainNode;
  ramp: MixerGainRamp;
};
type PitchShiftGraph = {
  context: AudioContext;
  element: HTMLMediaElement;
  isMultichannel: boolean;
  routingNodes: AudioNode[];
  channels: Map<MixerChannelId, AudioChannel>;
  processor: PitchProcessor | null;
  clickProcessor: ClickCueProcessor | null;
  clickInput: AudioNode | null;
  clickOutput: GainNode | null;
  output: GainNode;
  control: AudioProcessingControl | null;
  cancellation: AbortController;
  fail(error: unknown): void;
  ready: Promise<void>;
  rejectReady(reason: unknown): void;
  initializationDeadline: ReturnType<typeof setTimeout> | null;
  active: boolean;
  disposed: boolean;
};
type PitchShiftPlayback = Pick<PlaybackState,
  "audioRef" | "audioContextRef" | "audioGraphReadyRef" | "audioProcessingRef">;

function getAudioContextConstructor() {
  const audioWindow = window as typeof window & { webkitAudioContext?: AudioContextConstructor };
  return window.AudioContext ?? audioWindow.webkitAudioContext ?? null;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error
    ? `音声処理を開始できませんでした: ${error.message}`
    : "音声処理を開始できませんでした。";
}

function addChannel(graph: PitchShiftGraph, id: MixerChannelId, input: AudioNode, level: number) {
  const gain = graph.context.createGain();
  const volume = clampMixerVolume(level);
  // Preserve each stereo pair and initialize muted channels before connection.
  gain.channelCount = 2;
  gain.channelCountMode = "explicit";
  gain.gain.value = volume;
  graph.channels.set(id, { gain, ramp: {
    from: volume, to: volume, startTime: graph.context.currentTime, endTime: graph.context.currentTime
  } });
  input.connect(gain);
}

function changeChannelGain(graph: PitchShiftGraph, id: MixerChannelId, value: number) {
  const channel = graph.channels.get(id);
  const level = clampMixerVolume(value);
  if (!channel || channel.ramp.to === level) return;
  const parameter = channel.gain.gain;
  // Leave time for the render thread to receive automation. Scheduling at
  // currentTime can skip a render quantum and begin partway through the fade.
  const startTime = graph.context.currentTime + channelGainLeadSeconds;
  const current = getMixerGainAtTime(channel.ramp, startTime);
  const endTime = startTime + channelGainRampSeconds;
  if (typeof parameter.cancelAndHoldAtTime === "function") {
    parameter.cancelAndHoldAtTime(startTime);
  } else {
    parameter.cancelScheduledValues(startTime);
    // Cancelling a future endpoint also erases its preceding ramp. Restore
    // that segment before replacing it, including a not-yet-started fade.
    if (startTime > channel.ramp.startTime && startTime <= channel.ramp.endTime) {
      parameter.linearRampToValueAtTime(current, startTime);
    }
  }
  // A completed ramp need not leave an event at the hold time. Explicitly
  // anchor it so the next fade cannot interpolate from an old endpoint.
  parameter.setValueAtTime(current, startTime);
  parameter.linearRampToValueAtTime(level, endTime);
  channel.ramp = { from: current, to: level, startTime, endTime };
}

function disposeGraph(graph: PitchShiftGraph) {
  if (graph.disposed) return;
  graph.disposed = true;
  if (graph.initializationDeadline !== null) clearTimeout(graph.initializationDeadline);
  graph.initializationDeadline = null;
  graph.cancellation.abort(new DOMException("Audio graph was disposed.", "AbortError"));
  graph.rejectReady(new DOMException("Audio graph was disposed.", "AbortError"));
  try {
    for (const node of graph.routingNodes) node.disconnect();
    graph.routingNodes.length = 0;
    for (const channel of graph.channels.values()) {
      channel.gain.disconnect();
    }
    graph.channels.clear();
    graph.processor?.dispose();
    graph.clickProcessor?.dispose();
    graph.clickOutput?.disconnect();
    graph.output.disconnect();
  } finally {
    void graph.context.close().catch(() => undefined);
  }
}

export function useAudioPitchShift({
  isMultichannel,
  mediaUrl,
  originalVolume,
  playback,
  remainderVolume,
  semitones,
  stemVolume
}: {
  isMultichannel: boolean;
  mediaUrl: string;
  originalVolume: number;
  playback: PitchShiftPlayback;
  remainderVolume: number;
  semitones: number;
  stemVolume: number;
}) {
  const graphRef = useRef<PitchShiftGraph | null>(null);
  const settingsRef = useRef({ originalVolume, remainderVolume, stemVolume, semitones });
  const clickEnabledRef = useRef(false);
  const setClickEnabled = useCallback((enabled: boolean) => {
    clickEnabledRef.current = enabled;
    graphRef.current?.clickProcessor?.setEnabled(enabled);
  }, []);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [outputLatencySeconds, setOutputLatencySeconds] = useState(0);
  const [pitchShiftErrorMessage, setPitchShiftErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    settingsRef.current.originalVolume = originalVolume;
    settingsRef.current.remainderVolume = remainderVolume;
    settingsRef.current.stemVolume = stemVolume;
    const graph = graphRef.current;
    if (!graph || graph.disposed) return;
    changeChannelGain(graph, "original", originalVolume);
    changeChannelGain(graph, "stem", stemVolume);
    changeChannelGain(graph, "remainder", remainderVolume);
  }, [originalVolume, remainderVolume, stemVolume]);

  useEffect(() => {
    settingsRef.current.semitones = semitones;
    const graph = graphRef.current;
    if (graph?.processor && !graph.disposed) {
      void graph.processor.updatePitch().catch((error: unknown) => graph.fail(error));
    }
  }, [semitones]);

  useEffect(() => {
    const audio = playback.audioRef.current;
    const AudioContextCtor = getAudioContextConstructor();
    if (!audio) return;
    if (!AudioContextCtor) {
      setPitchShiftErrorMessage("このブラウザでは音声処理を利用できません。");
      return;
    }
    configurePlaybackAudioSession(navigator as AudioSessionNavigator);

    let graph = graphRef.current;
    if (!graph || graph.disposed || graph.element !== audio || graph.isMultichannel !== isMultichannel) {
      if (graph) disposeGraph(graph);
      setAudioContext(null);
      setOutputLatencySeconds(0);
      playback.audioContextRef.current = null;
      playback.audioProcessingRef.current = null;
      setPitchShiftErrorMessage(null);
      let resolveReady = () => {};
      let rejectReady: (reason: unknown) => void = () => {};
      const ready = new Promise<void>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
      });
      // Preserve rejection for transport, but handle initialization failure
      // before the first Play without an unhandled promise rejection.
      void ready.catch(() => undefined);
      playback.audioGraphReadyRef.current = ready;

      try {
        const context = new AudioContextCtor({ latencyHint: "interactive" });
        const output = context.createGain();
        output.channelCount = 2;
        output.channelCountMode = "explicit";
        output.gain.value = 0;
        output.connect(context.destination);
        graph = {
          context, element: audio, isMultichannel, routingNodes: [],
          channels: new Map(), processor: null, clickProcessor: null, clickInput: null,
          clickOutput: null, output, control: null,
          cancellation: new AbortController(),
          fail: () => undefined,
          ready, rejectReady, initializationDeadline: null, active: true, disposed: false
        };
        graphRef.current = graph;
        // One native transport supplies every stereo pair, including during
        // seek, rate changes and buffering. Creating its source now prevents a
        // temporary native-output bypass while the effect modules are loading.
        const source = context.createMediaElementSource(audio);
        graph.routingNodes.push(source);
        if (isMultichannel) {
          const splitter = context.createChannelSplitter(8);
          graph.routingNodes.push(splitter);
          source.connect(splitter);
          const channels = [
            { id: "original" as const, level: settingsRef.current.originalVolume },
            { id: "stem" as const, level: settingsRef.current.stemVolume },
            { id: "remainder" as const, level: settingsRef.current.remainderVolume }
          ];
          for (const [index, { id, level }] of channels.entries()) {
            const stereo = context.createChannelMerger(2);
            graph.routingNodes.push(stereo);
            splitter.connect(stereo, index * 2, 0);
            splitter.connect(stereo, index * 2 + 1, 1);
            addChannel(graph, id, stereo, level);
          }
          // The last two lanes carry sample-aligned beat cues, independent of
          // the three music gains and the pitch effect.
          const cues = context.createChannelMerger(2);
          graph.routingNodes.push(cues);
          splitter.connect(cues, 6, 0);
          splitter.connect(cues, 7, 1);
          graph.clickInput = cues;
          const clickOutput = context.createGain();
          clickOutput.channelCount = 2;
          clickOutput.channelCountMode = "explicit";
          clickOutput.gain.value = 0;
          clickOutput.connect(context.destination);
          graph.clickOutput = clickOutput;
        } else {
          addChannel(graph, "original", source, settingsRef.current.originalVolume);
        }

        const initializingGraph = graph;
        const failGraph = (error: unknown) => {
          if (initializingGraph.disposed) return;
          initializingGraph.output.gain.setValueAtTime(0, context.currentTime);
          initializingGraph.clickOutput?.gain.setValueAtTime(0, context.currentTime);
          audio.pause();
          rejectReady(error);
          if (initializingGraph.active) {
            setPitchShiftErrorMessage(getErrorMessage(error));
            setAudioContext(null);
          }
          if (playback.audioContextRef.current === context) playback.audioContextRef.current = null;
          if (playback.audioProcessingRef.current === initializingGraph.control) playback.audioProcessingRef.current = null;
          disposeGraph(initializingGraph);
        };
        initializingGraph.fail = failGraph;
        // One deadline covers module loading and all initialization RPCs. A
        // module request can otherwise stall before processor-level timeouts
        // exist. Disposal owns cancellation; late imports cannot revive it.
        initializingGraph.initializationDeadline = setTimeout(() => {
          failGraph(new Error("音声処理の準備が時間内に完了しませんでした。ページを再読み込みしてください。"));
        }, graphInitializationTimeoutMs);
        const initialize = async () => {
          try {
            const { createPitchProcessor } = await import("../../lib/pitchProcessor");
            if (initializingGraph.disposed) return;
            const processor = await createPitchProcessor({ context, element: audio,
              semitones: () => settingsRef.current.semitones,
              signal: initializingGraph.cancellation.signal,
              onError: failGraph });
            if (initializingGraph.disposed) { processor.dispose(); return; }
            initializingGraph.processor = processor;
            processor.node.connect(output);
            for (const channel of initializingGraph.channels.values()) channel.gain.connect(processor.node);
            if (initializingGraph.clickInput && initializingGraph.clickOutput) {
              const { createClickCueProcessor } = await import("../../lib/clickCueProcessor");
              if (initializingGraph.disposed) return;
              const clickProcessor = await createClickCueProcessor({ context,
                latencySeconds: processor.latencySeconds,
                signal: initializingGraph.cancellation.signal, onError: failGraph });
              if (initializingGraph.disposed) { clickProcessor.dispose(); return; }
              initializingGraph.clickProcessor = clickProcessor;
              initializingGraph.clickInput.connect(clickProcessor.node);
              clickProcessor.node.connect(initializingGraph.clickOutput);
              clickProcessor.setEnabled(clickEnabledRef.current);
            }
            // Reconcile changes made while initialization was awaiting RPCs.
            await processor.updatePitch();
            if (initializingGraph.disposed) return;
            const control: AudioProcessingControl = {
              element: audio,
              latencySeconds: processor.latencySeconds,
              silence: () => {
                if (!initializingGraph.disposed) {
                  output.gain.setValueAtTime(0, context.currentTime);
                  initializingGraph.clickOutput?.gain.setValueAtTime(0, context.currentTime);
                }
              },
              prepare: async () => {
                try {
                  await Promise.all([processor.prepare(), initializingGraph.clickProcessor?.prepare()]);
                } catch (error) { failGraph(error); throw error; }
              },
              open: () => {
                if (initializingGraph.disposed) throw new Error("Audio graph is unavailable.");
                output.gain.setValueAtTime(1, context.currentTime);
                initializingGraph.clickOutput?.gain.setValueAtTime(1, context.currentTime);
              }
            };
            initializingGraph.control = control;
            if (initializingGraph.initializationDeadline !== null) clearTimeout(initializingGraph.initializationDeadline);
            initializingGraph.initializationDeadline = null;
            resolveReady();
            if (initializingGraph.active) {
              // Enable transport only after a complete output path exists.
              // The first trusted Play then resumes without losing the opening.
              playback.audioContextRef.current = context;
              playback.audioProcessingRef.current = control;
              setAudioContext(context);
              setOutputLatencySeconds(processor.latencySeconds);
              setPitchShiftErrorMessage(null);
            }
          } catch (error) {
            failGraph(error);
          }
        };
        void initialize();
      } catch (error) {
        rejectReady(error);
        if (graph) disposeGraph(graph);
        playback.audioContextRef.current = null;
        setPitchShiftErrorMessage(getErrorMessage(error));
      }
    } else {
      graph.active = true;
      playback.audioGraphReadyRef.current = graph.ready;
      if (graph.control && graph.processor) {
        playback.audioContextRef.current = graph.context;
        playback.audioProcessingRef.current = graph.control;
        setAudioContext(graph.context);
        setOutputLatencySeconds(graph.processor.latencySeconds);
      }
    }

    const ownedGraph = graph;
    return () => {
      if (!ownedGraph) return;
      ownedGraph.active = false;
      // StrictMode immediately replays effects on the same media elements.
      // They cannot acquire a second MediaElementAudioSource, even in a new
      // context. Reuse on immediate setup; otherwise dispose after this commit.
      queueMicrotask(() => {
        if (ownedGraph.active) return;
        if (playback.audioContextRef.current === ownedGraph.context) playback.audioContextRef.current = null;
        if (playback.audioGraphReadyRef.current === ownedGraph.ready) playback.audioGraphReadyRef.current = null;
        if (playback.audioProcessingRef.current === ownedGraph.control) playback.audioProcessingRef.current = null;
        if (graphRef.current === ownedGraph) graphRef.current = null;
        disposeGraph(ownedGraph);
      });
    };
  }, [isMultichannel, mediaUrl, playback.audioContextRef, playback.audioGraphReadyRef, playback.audioProcessingRef, playback.audioRef]);

  useEffect(() => {
    if (semitones !== 0 && !getAudioContextConstructor()) {
      setPitchShiftErrorMessage("このブラウザではリアルタイム転調を利用できません。");
    }
  }, [semitones]);

  return { audioContext, outputLatencySeconds, pitchShiftErrorMessage, setClickEnabled };
}
