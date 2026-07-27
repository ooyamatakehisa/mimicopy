import {
  createAudioPlaybackGraph,
  getAudioPlaybackMode,
  restartAudioPlaybackGraph,
  stopAudioPlaybackGraph
} from "./audioEngine";

describe("audio playback mode", () => {
  it("uses one native buffer source for transparent normal playback", () => {
    expect(
      getAudioPlaybackMode({
        playbackRate: 1,
        semitones: 0
      })
    ).toBe("native");
  });

  it("uses granular playback only when speed or pitch processing is needed", () => {
    expect(
      getAudioPlaybackMode({
        playbackRate: 0.75,
        semitones: 0
      })
    ).toBe("granular");
    expect(
      getAudioPlaybackMode({
        playbackRate: 1,
        semitones: 1
      })
    ).toBe("granular");
  });

  it("schedules normal playback as one native buffer source", async () => {
    const audioContext = new AudioContext();
    const createBufferSource = vi.mocked(
      audioContext.createBufferSource
    );
    const graph = await createAudioPlaybackGraph(audioContext, {
      original: 1,
      remainder: 1,
      stem: 1
    });
    const audioBuffer = {
      duration: 10
    } as AudioBuffer;

    const contextTime = restartAudioPlaybackGraph({
      audioBuffers: {
        original: audioBuffer,
        remainder: null,
        stem: null
      },
      graph,
      mediaTime: 2,
      playbackRate: 1,
      semitones: 0
    });

    expect(createBufferSource).toHaveBeenCalledTimes(1);
    expect(createBufferSource.mock.results[0]?.value.start).toHaveBeenCalledWith(
      contextTime,
      2
    );

    stopAudioPlaybackGraph(graph);
  });
});
