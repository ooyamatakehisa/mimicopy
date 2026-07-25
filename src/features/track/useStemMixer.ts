import { useCallback, useMemo, useState } from "react";
import {
  clampMixerVolume,
  defaultMixerState,
  getEffectiveMixerVolume,
  type MixerChannelId,
  type MixerState
} from "../../lib/mixer";

export function useStemMixer() {
  const [channels, setChannels] = useState<MixerState>(defaultMixerState);

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
    []
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
      originalVolume: getEffectiveMixerVolume(channels, "original"),
      setVolume,
      stemVolume: getEffectiveMixerVolume(channels, "stem"),
      toggleMute,
      toggleSolo
    }),
    [channels, setVolume, toggleMute, toggleSolo]
  );
}

export type StemMixerState = ReturnType<typeof useStemMixer>;
