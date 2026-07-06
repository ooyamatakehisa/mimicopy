import { describe, expect, it } from "vitest";
import { buildWaveformPeaks } from "./waveform";

describe("waveform helpers", () => {
  it("summarizes audio samples into min/max peaks", () => {
    const peaks = buildWaveformPeaks(
      {
        duration: 1,
        getChannelData: () => new Float32Array([-1, 0.5, -0.25, 1]),
        length: 4,
        numberOfChannels: 1
      },
      2
    );

    expect(peaks).toEqual([
      { max: 0.5, min: -1 },
      { max: 1, min: -0.25 }
    ]);
  });
});
