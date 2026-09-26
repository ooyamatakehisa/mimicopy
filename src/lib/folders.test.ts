import { describe, expect, it } from "vitest";
import { filterLibraryTracks, parseFolder } from "./folders";
import { parseTrackSummary, type TrackSummary } from "./library";

const baseTrack: TrackSummary = {
  id: "unfiled",
  title: "Ｃａｆｅ Guitar",
  folderId: null,
  duration: 30,
  sourceType: "upload",
  mediaUrl: "/media/song.mp3",
  markerCount: 0,
  createdAt: "2026-09-26",
  updatedAt: "2026-09-26"
};
const tracks = [
  baseTrack,
  { ...baseTrack, id: "filed", folderId: "practice", title: "Guitar solo" }
];

describe("library folder filtering", () => {
  it("keeps unfiled and named folders separate while searching within the selected scope", () => {
    expect(filterLibraryTracks(tracks, "all", "guitar")).toHaveLength(2);
    expect(
      filterLibraryTracks(tracks, "unfiled", "guitar").map((track) => track.id)
    ).toEqual(["unfiled"]);
    expect(
      filterLibraryTracks(tracks, "folder:practice", "guitar").map(
        (track) => track.id
      )
    ).toEqual(["filed"]);
    expect(filterLibraryTracks(tracks, "folder:missing", "")).toEqual([]);
    expect(filterLibraryTracks(tracks, "folder:practice", "cafe")).toEqual([]);
  });
  it("handles case, surrounding whitespace and full-width characters", () => {
    expect(filterLibraryTracks(tracks, "all", " cafe ")).toEqual([baseTrack]);
  });
  it("reads older track responses as unfiled and rejects malformed folder data", () => {
    const { folderId: _folderId, ...legacyTrack } = baseTrack;
    expect(parseTrackSummary(legacyTrack)?.folderId).toBeNull();
    expect(parseTrackSummary({ ...baseTrack, folderId: 42 })).toBeNull();
    expect(() => parseFolder({ id: "folder", name: " " })).toThrow();
    expect(parseFolder({ id: "folder", name: "練習" })).toEqual({
      id: "folder",
      name: "練習"
    });
  });
});
