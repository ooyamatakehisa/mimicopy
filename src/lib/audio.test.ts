import { configurePlaybackAudioSession } from "./audio";

describe("playback audio session", () => {
  it("requests media playback when the Audio Session API is available", () => {
    const audioSession = {
      type: "auto" as const
    };

    configurePlaybackAudioSession({ audioSession });

    expect(audioSession.type).toBe("playback");
  });

  it("does nothing when the Audio Session API is unavailable", () => {
    expect(() => configurePlaybackAudioSession({})).not.toThrow();
  });
});
