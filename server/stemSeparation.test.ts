// @vitest-environment node

import { createServer } from "node:http";
import { describe, expect, it, vi } from "vitest";
import {
  createStemSeparatorClient,
  parseSeparationProgress
} from "./stemSeparation.js";

describe("parseSeparationProgress", () => {
  it("parses valid separator progress", () => {
    expect(
      parseSeparationProgress({
        completed_segments: 3,
        estimated_remaining_seconds: 12.5,
        total_segments: 8
      })
    ).toEqual({
      completedSegments: 3,
      estimatedRemainingSeconds: 12.5,
      totalSegments: 8
    });
  });

  it("rejects invalid segment counts", () => {
    expect(
      parseSeparationProgress({
        completed_segments: 9,
        estimated_remaining_seconds: 0,
        total_segments: 8
      })
    ).toBeNull();
  });

  it("polls progress while the separation request is running", async () => {
    let progressRequests = 0;
    const server = createServer(async (request, response) => {
      response.setHeader("Content-Type", "application/json");

      if (request.method === "POST") {
        await new Promise((resolve) => setTimeout(resolve, 180));
        response.end(JSON.stringify({ elapsed_seconds: 0.18 }));
        return;
      }

      progressRequests += 1;
      response.end(
        JSON.stringify({
          completed_segments: 2,
          estimated_remaining_seconds: 12.5,
          total_segments: 8
        })
      );
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    try {
      const address = server.address();

      if (!address || typeof address === "string") {
        throw new Error("Test server did not expose a port.");
      }

      const onProgress = vi.fn();
      const separate = createStemSeparatorClient({
        baseUrl: `http://127.0.0.1:${address.port}`,
        progressPollIntervalMs: 50
      });

      await separate({
        inputFilename: "input.mp3",
        onProgress,
        outputFilename: "output-guitar.mp3",
        remainderOutputFilename: "output-guitar-remainder.mp3",
        targetStem: "guitar"
      });

      expect(progressRequests).toBeGreaterThan(0);
      expect(onProgress).toHaveBeenCalledWith({
        completedSegments: 2,
        estimatedRemainingSeconds: 12.5,
        totalSegments: 8
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
});
