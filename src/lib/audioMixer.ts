import type { MixerChannelId } from "./mixer";

export type MixerVolumes = Record<MixerChannelId, number>;
export type MixerGainNodes = Record<MixerChannelId, GainNode>;

const mixerChannelIds: MixerChannelId[] = [
  "original",
  "stem",
  "remainder"
];

export function createMixerGainNodes(audioContext: AudioContext) {
  return Object.fromEntries(
    mixerChannelIds.map((channelId) => {
      const gain = audioContext.createGain();

      gain.connect(audioContext.destination);

      return [channelId, gain];
    })
  ) as MixerGainNodes;
}

export function setMixerGainVolumes({
  audioContext,
  gains,
  volumes
}: {
  audioContext: AudioContext;
  gains: MixerGainNodes;
  volumes: MixerVolumes;
}) {
  for (const channelId of mixerChannelIds) {
    gains[channelId].gain.setValueAtTime(
      volumes[channelId],
      audioContext.currentTime
    );
  }
}

export function disconnectMixerGainNodes(gains: MixerGainNodes) {
  for (const gain of Object.values(gains)) {
    gain.disconnect();
  }
}
