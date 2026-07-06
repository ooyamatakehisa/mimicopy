import { describe, expect, it } from "vitest";
import { getYoutubeVideoId, youtubeDownloadPlans } from "./index.js";

describe("getYoutubeVideoId", () => {
  it("extracts the video id from playlist-backed watch URLs", () => {
    expect(
      getYoutubeVideoId(
        "https://www.youtube.com/watch?v=DFRdswY-WHU&list=RDDFRdswY-WHU&start_radio=1"
      )
    ).toBe("DFRdswY-WHU");

    expect(
      getYoutubeVideoId(
        "https://www.youtube.com/watch?v=GVFR9zmQjec&list=RDGVFR9zmQjec&start_radio=1"
      )
    ).toBe("GVFR9zmQjec");
  });

  it("extracts video ids from common YouTube URL forms", () => {
    expect(getYoutubeVideoId("https://youtu.be/DFRdswY-WHU?t=42")).toBe(
      "DFRdswY-WHU"
    );
    expect(
      getYoutubeVideoId("https://www.youtube.com/shorts/GVFR9zmQjec")
    ).toBe("GVFR9zmQjec");
    expect(
      getYoutubeVideoId("https://music.youtube.com/watch?v=DFRdswY-WHU")
    ).toBe("DFRdswY-WHU");
  });

  it("rejects non-YouTube URLs", () => {
    expect(() =>
      getYoutubeVideoId("https://example.com/watch?v=DFRdswY-WHU")
    ).toThrow("Enter a valid YouTube video URL.");
  });
});

describe("youtubeDownloadPlans", () => {
  it("tries lightweight audio first, then Android progressive MP4 fallbacks", () => {
    expect(youtubeDownloadPlans).toEqual([
      {
        client: "IOS",
        label: "iOS audio-only MP4",
        options: { format: "mp4", quality: "best", type: "audio" }
      },
      {
        client: "ANDROID",
        label: "Android 360p MP4 video",
        options: { format: "mp4", quality: "360p", type: "video+audio" }
      },
      {
        client: "ANDROID",
        label: "Android best MP4 video",
        options: { format: "mp4", quality: "best", type: "video+audio" }
      }
    ]);
  });
});
