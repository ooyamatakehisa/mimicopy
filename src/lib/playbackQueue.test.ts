import { describe, expect, it } from "vitest";
import { nextQueuedTrack, readPlaybackQueue } from "./playbackQueue";

describe("playback queue", () => {
  const queue = { trackIds: ["a", "c", "b"], label: "練習" };
  it("follows the captured list order and stops at the end", () => {
    expect(nextQueuedTrack(queue, "a")).toBe("c");
    expect(nextQueuedTrack(queue, "c")).toBe("b");
    expect(nextQueuedTrack(queue, "b")).toBeNull();
    expect(nextQueuedTrack(queue, "missing")).toBeNull();
    expect(nextQueuedTrack(null, "a")).toBeNull();
  });
  it("validates router state before using a queue", () => {
    expect(readPlaybackQueue(queue)).toEqual(queue);
    for (const value of [null, {}, { ...queue, trackIds: [42] }, { ...queue, label: null }]) {
      expect(readPlaybackQueue(value)).toBeNull();
    }
  });
});
