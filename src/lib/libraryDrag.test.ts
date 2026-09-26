import { describe, expect, it } from "vitest";
import type { TrackSummary } from "./library";
import { getTrackMove } from "./libraryDrag";

const base: TrackSummary = {
  id: "one",
  title: "Song",
  folderId: null,
  duration: 30,
  sourceType: "upload",
  mediaUrl: "/media/song.mp3",
  markerCount: 0,
  createdAt: "2026-09-26",
  updatedAt: "2026-09-26"
};
const tracks = [base, { ...base, id: "two", folderId: "practice" }];
const source = { kind: "tracks", title: "Song", trackIds: ["one", "two"] };
const folder = { kind: "folder", name: "Practice", folderId: "practice" };

describe("dragging library tracks", () => {
  it("moves only tracks outside the destination and removes duplicate IDs", () => {
    expect(
      getTrackMove(
        { ...source, trackIds: ["one", "two", "one"] },
        folder,
        tracks
      )
    ).toEqual({ trackIds: ["one"], folderId: "practice" });
    expect(getTrackMove(source, { ...folder, folderId: null }, tracks)).toEqual(
      { trackIds: ["two"], folderId: null }
    );
  });

  it("does nothing when the whole selection is already in the folder", () => {
    expect(
      getTrackMove({ ...source, trackIds: ["two"] }, folder, tracks)
    ).toBeNull();
  });

  it("rejects missing destinations, stale tracks and malformed drag data", () => {
    expect(getTrackMove(source, undefined, tracks)).toBeNull();
    expect(getTrackMove(source, folder, [base])).toBeNull();
    expect(
      getTrackMove({ ...source, trackIds: [42] }, folder, tracks)
    ).toBeNull();
    expect(
      getTrackMove({ ...source, trackIds: [] }, folder, tracks)
    ).toBeNull();
    expect(
      getTrackMove(source, { ...folder, folderId: 42 }, tracks)
    ).toBeNull();
  });

  it("respects the server's 500-track move limit", () => {
    const largeLibrary = Array.from({ length: 501 }, (_, index) => ({
      ...base,
      id: String(index)
    }));
    const largeSource = {
      ...source,
      trackIds: largeLibrary.map((track) => track.id)
    };
    expect(getTrackMove(largeSource, folder, largeLibrary)).toBeNull();
    expect(
      getTrackMove(
        { ...largeSource, trackIds: largeSource.trackIds.slice(0, 500) },
        folder,
        largeLibrary
      )?.trackIds
    ).toHaveLength(500);
  });
});
