// @vitest-environment node

import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp, getYoutubeVideoId, youtubeDownloadPlans } from "./index.js";

const tempDirs: string[] = [];

async function createTempStorageDir() {
  const storageDir = await mkdtemp(path.join(tmpdir(), "mimicopy-"));
  tempDirs.push(storageDir);

  return storageDir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) => rm(directory, { force: true, recursive: true }))
  );
});

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

    expect(
      getYoutubeVideoId(
        "https://www.youtube.com/watch?v=OS45uTF_8P0&list=RDOS45uTF_8P0&start_radio=1"
      )
    ).toBe("OS45uTF_8P0");
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

describe("beat grid API", () => {
  it("analyzes a stored track with the configured beat analyzer", async () => {
    const storageDir = await createTempStorageDir();
    const app = createApp({
      analyzeBeats: async (audioPath) => {
        expect(path.basename(audioPath)).toMatch(/\.mp3$/);

        return {
          analyzedAt: "2026-07-20T00:00:00.000Z",
          beats: [
            { isDownbeat: true, position: 1, time: 0.5 },
            { isDownbeat: false, position: 2, time: 1 }
          ],
          beatsPerBar: [4],
          downbeats: [0.5],
          source: "madmom"
        };
      },
      storageDir
    });
    const server = app.listen(0);

    try {
      const address = server.address();

      if (!address || typeof address === "string") {
        throw new Error("Test server did not expose a port.");
      }

      const baseUrl = `http://127.0.0.1:${address.port}`;
      const uploadResponse = await fetch(`${baseUrl}/api/tracks`, {
        body: new Uint8Array([1, 2, 3]),
        headers: {
          "Content-Type": "audio/mpeg",
          "X-File-Name": "phrase.mp3"
        },
        method: "POST"
      });
      const uploadBody = (await uploadResponse.json()) as {
        track: { id: string };
      };
      const analysisResponse = await fetch(
        `${baseUrl}/api/tracks/${uploadBody.track.id}/beat-grid`,
        {
          method: "POST"
        }
      );

      await expect(analysisResponse.json()).resolves.toEqual({
        beatGrid: {
          analyzedAt: "2026-07-20T00:00:00.000Z",
          beats: [
            { isDownbeat: true, position: 1, time: 0.5 },
            { isDownbeat: false, position: 2, time: 1 }
          ],
          beatsPerBar: [4],
          downbeats: [0.5],
          source: "madmom"
        }
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
  });

  it("analyzes a temporary YouTube click source without adding it to the library", async () => {
    const storageDir = await createTempStorageDir();
    const convertedPaths: string[] = [];
    const app = createApp({
      analyzeBeats: async (audioPath) => {
        expect(audioPath).toBe(convertedPaths[0]);

        return {
          analyzedAt: "2026-07-20T00:00:00.000Z",
          beats: [
            { isDownbeat: true, position: 1, time: 0.25 },
            { isDownbeat: false, position: 2, time: 0.75 }
          ],
          beatsPerBar: [4],
          downbeats: [0.25],
          source: "madmom"
        };
      },
      convertYoutubeAudio: async (videoId, outputPath) => {
        expect(videoId).toBe("DFRdswY-WHU");
        convertedPaths.push(outputPath);
        await writeFile(outputPath, new Uint8Array([1, 2, 3]));

        return { duration: 12, title: "Reference groove" };
      },
      storageDir
    });
    const server = app.listen(0);

    try {
      const address = server.address();

      if (!address || typeof address === "string") {
        throw new Error("Test server did not expose a port.");
      }

      const baseUrl = `http://127.0.0.1:${address.port}`;
      const analysisResponse = await fetch(`${baseUrl}/api/beat-grid/youtube`, {
        body: JSON.stringify({
          url: "https://www.youtube.com/watch?v=DFRdswY-WHU&list=RDDFRdswY-WHU"
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });

      await expect(analysisResponse.json()).resolves.toEqual({
        beatGrid: {
          analyzedAt: "2026-07-20T00:00:00.000Z",
          beats: [
            { isDownbeat: true, position: 1, time: 0.25 },
            { isDownbeat: false, position: 2, time: 0.75 }
          ],
          beatsPerBar: [4],
          downbeats: [0.25],
          source: "madmom"
        },
        reference: {
          duration: 12,
          sourceType: "youtube",
          title: "Reference groove"
        }
      });
      await expect(
        fetch(`${baseUrl}/api/tracks`).then((response) => response.json())
      ).resolves.toEqual({ tracks: [] });
      await expect(access(convertedPaths[0] ?? "")).rejects.toThrow();
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
  });
});
