import { describe, expect, it } from "vitest";
import {
  clampTime,
  formatTime,
  getShortcutCommand,
  nextPlaybackRate,
  parseTimeInput,
  seekBy
} from "./playback";

describe("playback helpers", () => {
  it("moves through YouTube-like playback rates", () => {
    expect(nextPlaybackRate(0.5, "faster")).toBe(0.75);
    expect(nextPlaybackRate(0.75, "faster")).toBe(1);
    expect(nextPlaybackRate(1, "faster")).toBe(1);
    expect(nextPlaybackRate(0.25, "slower")).toBe(0.25);
    expect(nextPlaybackRate(1, "slower")).toBe(0.75);
  });

  it("keeps seek positions inside duration", () => {
    expect(clampTime(-1, 120)).toBe(0);
    expect(clampTime(130, 120)).toBe(120);
    expect(seekBy(12, -5, 120)).toBe(7);
    expect(seekBy(118, 5, 120)).toBe(120);
  });

  it("formats and parses time values", () => {
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(3_665)).toBe("1:01:05");
    expect(parseTimeInput("1:23", 300)).toBe(83);
    expect(parseTimeInput("1:02:03", 9_000)).toBe(3_723);
    expect(parseTimeInput("n/a", 300)).toBeNull();
  });

  it("maps keyboard events to editor commands", () => {
    expect(getShortcutCommand({ key: " ", shiftKey: false })).toEqual({
      type: "togglePlayback"
    });
    expect(getShortcutCommand({ key: "ArrowLeft" })).toEqual({
      deltaSeconds: -5,
      type: "seek"
    });
    expect(getShortcutCommand({ key: "l" })).toEqual({
      deltaSeconds: 10,
      type: "seek"
    });
    expect(getShortcutCommand({ key: ".", shiftKey: true })).toEqual({
      direction: "faster",
      type: "speed"
    });
    expect(getShortcutCommand({ key: "Delete" })).toEqual({
      type: "returnToMarker"
    });
  });
});
