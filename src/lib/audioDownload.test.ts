import { describe, expect, it } from "vitest";
import { getTrackAudioDownloadFilename } from "./audioDownload";

describe("getTrackAudioDownloadFilename", () => {
  it("names original and separated audio from the track title", () => {
    expect(
      getTrackAudioDownloadFilename("Practice phrase.mp3", "original", "guitar")
    ).toBe("Practice phrase.mp3");
    expect(
      getTrackAudioDownloadFilename("Practice phrase.mp3", "stem", "guitar")
    ).toBe("Practice phrase-guitar.mp3");
    expect(
      getTrackAudioDownloadFilename(
        "Practice phrase.mp3",
        "remainder",
        "guitar"
      )
    ).toBe("Practice phrase-guitar-remainder.mp3");
  });

  it("removes unsafe filename characters and supplies a fallback", () => {
    expect(
      getTrackAudioDownloadFilename("  phrase/one?.MP3 ", "stem", "vocals")
    ).toBe("phrase-one-vocals.mp3");
    expect(getTrackAudioDownloadFilename("...", "original", "drums")).toBe(
      "audio.mp3"
    );
  });
});
