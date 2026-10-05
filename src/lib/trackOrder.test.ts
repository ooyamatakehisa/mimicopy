import { describe, expect, it } from "vitest";
import { moveTrackToIndex, readTrackOrderDragData } from "./trackOrder";

describe("moveTrackToIndex", () => {
  it("moves both ways without mutating the saved order", () => {
    const saved = ["a", "b", "c", "d"];
    expect(moveTrackToIndex(saved, "a", 3)).toEqual(["b", "c", "d", "a"]);
    expect(moveTrackToIndex(saved, "d", 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveTrackToIndex(saved, "b", 2)).toEqual(["a", "c", "b", "d"]);
    expect(saved).toEqual(["a", "b", "c", "d"]);
  });
  it("ignores missing tracks, boundaries and unchanged positions", () => {
    const saved = ["a", "b"];
    for (const [id, index] of [["missing", 0], ["a", -1], ["b", 2], ["a", 0]] as const) {
      expect(moveTrackToIndex(saved, id, index)).toBe(saved);
    }
  });
});
it("keeps folder drags distinct from ordering drags", () => {
  expect(readTrackOrderDragData({ kind: "tracks", trackIds: ["a"], title: "A" })).toBeNull();
  expect(readTrackOrderDragData(null)).toBeNull();
  expect(readTrackOrderDragData({ kind: "track-order", trackId: "a", title: "A" })).toEqual({ kind: "track-order", trackId: "a", title: "A" });
});
