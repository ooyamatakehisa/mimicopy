import { describe, expect, it } from "vitest";
import {
  createMarker,
  findReturnMarker,
  removeMarker,
  sortMarkers,
  type Marker
} from "./markers";

const markers: Marker[] = [
  { id: "late", label: "Late", time: 42 },
  { id: "early", label: "Early", time: 8 },
  { id: "middle", label: "Middle", time: 20 }
];

describe("marker helpers", () => {
  it("creates and sorts markers by time", () => {
    expect(createMarker("new", 12, 2)).toEqual({
      id: "new",
      label: "Marker 3",
      time: 12
    });
    expect(sortMarkers(markers).map((marker) => marker.id)).toEqual([
      "early",
      "middle",
      "late"
    ]);
  });

  it("finds a selected marker before falling back to current position", () => {
    expect(findReturnMarker(markers, "late", 9)?.id).toBe("late");
    expect(findReturnMarker(markers, null, 21)?.id).toBe("middle");
    expect(findReturnMarker(markers, null, 1)?.id).toBe("early");
  });

  it("removes markers without mutating the input", () => {
    const nextMarkers = removeMarker(markers, "middle");

    expect(nextMarkers.map((marker) => marker.id)).toEqual(["late", "early"]);
    expect(markers).toHaveLength(3);
  });
});
