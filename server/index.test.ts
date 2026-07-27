// @vitest-environment node

import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, getYoutubeVideoId, youtubeDownloadPlans } from "./index.js";
import type { SeparateAudioInput } from "./stemSeparation.js";

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
  it("automatically analyzes an uploaded MP3 in the background", async () => {
    const storageDir = await createTempStorageDir();
    let finishAnalysis: (() => void) | undefined;
    const analysisGate = new Promise<void>((resolve) => {
      finishAnalysis = resolve;
    });
    const analyzedPaths: string[] = [];
    const app = createApp({
      analyzeBeats: async (audioPath) => {
        analyzedPaths.push(audioPath);
        expect(path.basename(audioPath)).toMatch(/\.mp3$/);
        await analysisGate;

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
      const beatGridUrl = `${baseUrl}/api/tracks/${uploadBody.track.id}/beat-grid`;

      await vi.waitFor(() => {
        expect(analyzedPaths).toHaveLength(1);
      });
      await expect(fetch(beatGridUrl).then((response) => response.json())).resolves.toMatchObject({
        beatGrid: null,
        error: null,
        status: "running"
      });
      finishAnalysis?.();
      await vi.waitFor(async () => {
        const analysis = (await fetch(beatGridUrl).then((response) =>
          response.json()
        )) as { status?: unknown };

        expect(analysis.status).toBe("completed");
      });
      await expect(fetch(beatGridUrl).then((response) => response.json())).resolves.toMatchObject({
        beatGrid: {
          analyzedAt: "2026-07-20T00:00:00.000Z",
          beats: [
            { isDownbeat: true, position: 1, time: 0.5 },
            { isDownbeat: false, position: 2, time: 1 }
          ],
          beatsPerBar: [4],
          downbeats: [0.5],
          source: "madmom"
        },
        error: null,
        status: "completed"
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

  it("automatically analyzes the MP3 produced by YouTube conversion", async () => {
    const storageDir = await createTempStorageDir();
    const convertedPaths: string[] = [];
    const analyzedPaths: string[] = [];
    const app = createApp({
      analyzeBeats: async (audioPath) => {
        analyzedPaths.push(audioPath);

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
      const conversionResponse = await fetch(`${baseUrl}/api/youtube`, {
        body: JSON.stringify({
          targetStem: null,
          url: "https://www.youtube.com/watch?v=DFRdswY-WHU&list=RDDFRdswY-WHU"
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const conversionBody = (await conversionResponse.json()) as {
        track: { id: string };
      };
      const beatGridUrl = `${baseUrl}/api/tracks/${conversionBody.track.id}/beat-grid`;

      await vi.waitFor(() => {
        expect(analyzedPaths).toEqual(convertedPaths);
      });
      await vi.waitFor(async () => {
        const analysis = (await fetch(beatGridUrl).then((response) =>
          response.json()
        )) as { status?: unknown };

        expect(analysis.status).toBe("completed");
      });
      await expect(fetch(beatGridUrl).then((response) => response.json())).resolves.toMatchObject({
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
        error: null,
        status: "completed"
      });
      expect(convertedPaths).toHaveLength(1);
      await expect(access(convertedPaths[0] ?? "")).resolves.toBeUndefined();
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

describe("YouTube stem separation API", () => {
  it("queues one requested stem and exposes it on the saved track", async () => {
    const storageDir = await createTempStorageDir();
    let finishSeparation: (() => void) | undefined;
    const separationGate = new Promise<void>((resolve) => {
      finishSeparation = resolve;
    });
    const separationCalls: SeparateAudioInput[] = [];
    const app = createApp({
      analyzeBeats: async () => ({
        analyzedAt: "2026-07-20T00:00:00.000Z",
        beats: [],
        beatsPerBar: [4],
        downbeats: [],
        source: "madmom"
      }),
      convertYoutubeAudio: async (videoId, outputPath) => {
        expect(videoId).toBe("OS45uTF_8P0");
        await writeFile(outputPath, new Uint8Array([1, 2, 3]));
        return { duration: 306, title: "Tokyo Incidents" };
      },
      separateAudio: async (input) => {
        separationCalls.push(input);
        input.onProgress?.({
          completedSegments: 2,
          estimatedRemainingSeconds: 18.5,
          totalSegments: 5
        });
        await separationGate;
        await writeFile(
          path.join(storageDir, "media", input.outputFilename),
          new Uint8Array([4, 5, 6])
        );
        await writeFile(
          path.join(
            storageDir,
            "media",
            input.remainderOutputFilename
          ),
          new Uint8Array([7, 8, 9])
        );
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
      const response = await fetch(`${baseUrl}/api/youtube`, {
        body: JSON.stringify({
          targetStem: "guitar",
          url: "https://www.youtube.com/watch?v=OS45uTF_8P0"
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const body = (await response.json()) as {
        track: {
          id: string;
          separation: {
            mediaUrl: string | null;
            remainderMediaUrl: string | null;
            status: string;
            targetStem: string;
          };
        };
      };

      expect(response.status).toBe(200);
      expect(body.track.separation).toMatchObject({
        mediaUrl: null,
        remainderMediaUrl: null,
        status: "queued",
        targetStem: "guitar"
      });

      await vi.waitFor(() => {
        expect(separationCalls).toHaveLength(1);
      });
      expect(separationCalls[0]).toMatchObject({
        inputFilename: expect.stringMatching(/\.mp3$/),
        outputFilename: expect.stringMatching(/-guitar\.mp3$/),
        remainderOutputFilename: expect.stringMatching(
          /-guitar-remainder\.mp3$/
        ),
        targetStem: "guitar"
      });

      const runningTrack = await fetch(
        `${baseUrl}/api/tracks/${body.track.id}`
      ).then((trackResponse) => trackResponse.json()) as {
        track: {
          separation: {
            progress: {
              completedSegments: number;
              estimatedRemainingSeconds: number | null;
              percentage: number;
              totalSegments: number;
            };
            status: string;
          };
        };
      };
      expect(runningTrack.track.separation.status).toBe("running");
      expect(runningTrack.track.separation.progress).toEqual({
        completedSegments: 2,
        estimatedRemainingSeconds: 18.5,
        percentage: 40,
        totalSegments: 5
      });

      finishSeparation?.();

      await vi.waitFor(async () => {
        const completedTrack = await fetch(
          `${baseUrl}/api/tracks/${body.track.id}`
        ).then((trackResponse) => trackResponse.json()) as {
          track: {
            separation: {
              mediaUrl: string | null;
              progress: {
                completedSegments: number;
                percentage: number;
                totalSegments: number;
              };
              remainderMediaUrl: string | null;
              status: string;
            };
          };
        };

        expect(completedTrack.track.separation.status).toBe("completed");
        expect(completedTrack.track.separation.mediaUrl).toMatch(
          /^\/media\/.+-guitar\.mp3$/
        );
        expect(
          completedTrack.track.separation.remainderMediaUrl
        ).toMatch(/^\/media\/.+-guitar-remainder\.mp3$/);
        expect(completedTrack.track.separation.progress).toMatchObject({
          completedSegments: 5,
          percentage: 100,
          totalSegments: 5
        });
      });
    } finally {
      finishSeparation?.();
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

  it("rejects unsupported stem names before downloading audio", async () => {
    const storageDir = await createTempStorageDir();
    const convertYoutubeAudio = vi.fn();
    const app = createApp({ convertYoutubeAudio, storageDir });
    const server = app.listen(0);

    try {
      const address = server.address();

      if (!address || typeof address === "string") {
        throw new Error("Test server did not expose a port.");
      }

      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/youtube`,
        {
          body: JSON.stringify({
            targetStem: "saxophone",
            url: "https://www.youtube.com/watch?v=OS45uTF_8P0"
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST"
        }
      );

      expect(response.status).toBe(400);
      expect(convertYoutubeAudio).not.toHaveBeenCalled();
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
