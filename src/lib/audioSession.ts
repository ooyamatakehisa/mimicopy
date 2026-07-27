type AudioSessionType =
  | "ambient"
  | "auto"
  | "play-and-record"
  | "playback"
  | "transient"
  | "transient-solo";

export type AudioSessionNavigator = {
  readonly audioSession?: {
    type: AudioSessionType;
  };
};

export function configurePlaybackAudioSession(
  navigatorObject: AudioSessionNavigator
) {
  if (navigatorObject.audioSession) {
    navigatorObject.audioSession.type = "playback";
  }
}
