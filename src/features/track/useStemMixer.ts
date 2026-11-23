import { useCallback, useMemo, type Dispatch, type SetStateAction } from "react";
import {
  clampMixerVolume,
  getEffectiveMixerVolume,
  type MixerChannelId,
  type MixerState
} from "../../lib/mixer";

export function useStemMixer(
  channels: MixerState,
  setChannels: Dispatch<SetStateAction<MixerState>>,
  mixerReady: boolean
) {
  const updateChannel = useCallback(
    (
      channelId: MixerChannelId,
      update: (channel: MixerState[MixerChannelId]) => MixerState[MixerChannelId]
    ) => {
      setChannels((currentChannels) => ({
        ...currentChannels,
        [channelId]: update(currentChannels[channelId])
      }));
    },
    [setChannels]
  );

  const setVolume = useCallback(
    (channelId: MixerChannelId, volume: number) => {
      updateChannel(channelId, (channel) => ({
        ...channel,
        volume: clampMixerVolume(volume)
      }));
    },
    [updateChannel]
  );

  const toggleMute = useCallback(
    (channelId: MixerChannelId) => {
      updateChannel(channelId, (channel) => ({
        ...channel,
        muted: !channel.muted
      }));
    },
    [updateChannel]
  );

  const toggleSolo = useCallback(
    (channelId: MixerChannelId) => {
      updateChannel(channelId, (channel) => ({
        ...channel,
        solo: !channel.solo
      }));
    },
    [updateChannel]
  );

  return useMemo(
    () => ({
      channels,
      originalVolume: mixerReady
        ? getEffectiveMixerVolume(channels, "original")
        : channels.original.muted ? 0 : channels.original.volume,
      remainderVolume: getEffectiveMixerVolume(channels, "remainder"),
      setVolume,
      stemVolume: getEffectiveMixerVolume(channels, "stem"),
      toggleMute,
      toggleSolo
    }),
    [channels, mixerReady, setVolume, toggleMute, toggleSolo]
  );
}

export type StemMixerState = ReturnType<typeof useStemMixer>;
