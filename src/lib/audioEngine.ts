import type { Context } from "tone/build/esm/core/context/Context.js";
import type { GrainPlayer } from "tone/build/esm/source/buffer/GrainPlayer.js";
import {
  createMixerGainNodes,
  disconnectMixerGainNodes,
  setMixerGainVolumes,
  type MixerGainNodes,
  type MixerVolumes
} from "./audioMixer";
import { startSynchronizedAudioPlayers } from "./audioTransport";
import type { MixerChannelId } from "./mixer";
import type { PlaybackRate } from "./playback";

const playbackStartLeadSeconds = 0.03;

export type PlaybackAudioBuffers = Record<
  MixerChannelId,
  AudioBuffer | null
>;

type AudioEnvironment = {
  GrainPlayerClass: typeof GrainPlayer;
  toneContext: Context;
};

export type AudioPlaybackGraph = {
  audioContext: AudioContext;
  environment: AudioEnvironment;
  gains: MixerGainNodes;
  players: GrainPlayer[];
};

let audioEnvironmentPromise: Promise<AudioEnvironment> | null = null;

async function getAudioEnvironment(audioContext: AudioContext) {
  if (!audioEnvironmentPromise) {
    audioEnvironmentPromise = Promise.all([
      import("tone/build/esm/core/context/Context.js"),
      import("tone/build/esm/source/buffer/GrainPlayer.js")
    ])
      .then(([{ Context: ToneContext }, { GrainPlayer: GrainPlayerClass }]) => ({
        GrainPlayerClass,
        toneContext: new ToneContext({
          context: audioContext,
          latencyHint: "interactive",
          lookAhead: 0
        })
      }))
      .catch((error: unknown) => {
        audioEnvironmentPromise = null;
        throw error;
      });
  }

  return audioEnvironmentPromise;
}

export async function createAudioPlaybackGraph(
  audioContext: AudioContext,
  volumes: MixerVolumes
) {
  const environment = await getAudioEnvironment(audioContext);
  const gains = createMixerGainNodes(audioContext);
  const graph: AudioPlaybackGraph = {
    audioContext,
    environment,
    gains,
    players: []
  };

  setMixerGainVolumes({ audioContext, gains, volumes });

  return graph;
}

export function stopAudioPlaybackGraph(graph: AudioPlaybackGraph) {
  const players = graph.players.splice(0);

  for (const player of players) {
    try {
      player.stop(graph.audioContext.currentTime);
    } catch {
      // A player can already be stopped when its buffer reaches the end.
    }

    player.dispose();
  }
}

export function destroyAudioPlaybackGraph(graph: AudioPlaybackGraph) {
  stopAudioPlaybackGraph(graph);
  disconnectMixerGainNodes(graph.gains);
}

export function setAudioPlaybackGraphVolumes(
  graph: AudioPlaybackGraph,
  volumes: MixerVolumes
) {
  setMixerGainVolumes({
    audioContext: graph.audioContext,
    gains: graph.gains,
    volumes
  });
}

export function setAudioPlaybackGraphSemitones(
  graph: AudioPlaybackGraph,
  semitones: number
) {
  for (const player of graph.players) {
    player.detune = semitones * 100;
  }
}

export function restartAudioPlaybackGraph({
  audioBuffers,
  graph,
  mediaTime,
  playbackRate,
  semitones
}: {
  audioBuffers: PlaybackAudioBuffers;
  graph: AudioPlaybackGraph;
  mediaTime: number;
  playbackRate: PlaybackRate;
  semitones: number;
}) {
  stopAudioPlaybackGraph(graph);

  const nextPlayers = (
    Object.entries(audioBuffers) as Array<
      [MixerChannelId, AudioBuffer | null]
    >
  ).flatMap(([channelId, audioBuffer]) => {
    if (!audioBuffer || mediaTime >= audioBuffer.duration) {
      return [];
    }

    const player = new graph.environment.GrainPlayerClass({
      context: graph.environment.toneContext,
      detune: semitones * 100,
      grainSize: 0.1,
      overlap: 0.05,
      playbackRate,
      url: audioBuffer
    });

    player.connect(graph.gains[channelId]);

    return [player];
  });
  const contextTime =
    graph.audioContext.currentTime + playbackStartLeadSeconds;

  try {
    startSynchronizedAudioPlayers(nextPlayers, contextTime, mediaTime);
  } catch (error) {
    for (const player of nextPlayers) {
      player.dispose();
    }

    throw error;
  }

  graph.players = nextPlayers;

  return contextTime;
}
