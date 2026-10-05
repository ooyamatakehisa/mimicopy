import { expect, it } from "vitest";
import type { TrackDetail } from "./library";
import { toTrackSummary } from "./library";
import { upsertTrackSummary } from "./trackCache";

function track(id: string): TrackDetail {
  return {
    id, title: id, folderId: null, sourceType: "upload", mediaUrl: `/media/${id}.mp3`,
    duration: 10, markerCount: 0, markers: [], separation: null,
    createdAt: "2026-01-01", updatedAt: "2026-01-01"
  };
}
it("preserves server order when caching a renamed or edited existing track", () => {
  const saved = ["a", "c", "b"].map((id) => toTrackSummary(track(id)));
  const result = upsertTrackSummary(saved, { ...track("b"), title: "Renamed", updatedAt: "2026-10-01" });
  expect(result.map((item) => item.id)).toEqual(["a", "c", "b"]);
  expect(result[2].title).toBe("Renamed");
  expect(saved[2].title).toBe("b");
});
it("prepends newly imported tracks while preserving the existing order", () => {
  const saved = ["c", "a", "b"].map((id) => toTrackSummary(track(id)));
  expect(upsertTrackSummary(saved, track("new")).map((item) => item.id)).toEqual(["new", "c", "a", "b"]);
  expect(upsertTrackSummary(undefined, track("new"))).toEqual([toTrackSummary(track("new"))]);
});
