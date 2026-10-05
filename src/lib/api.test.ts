import { createHash, webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getClickCueRevisionInput } from "../../server/clickCueFormat";
import type { BeatGrid } from "./beats";
import { fetchTrackMixer, MixerCueRevisionError } from "./api";

const grid: BeatGrid = { source: "madmom", analyzedAt: "2026-10-05T00:00:00.000Z",
  beats: [{ time: .5, position: 1, isDownbeat: true }], downbeats: [.5], beatsPerBar: [4] };
const revision = createHash("sha256").update(getClickCueRevisionInput(grid)).digest("hex");

describe("mixer cue revision", () => {
  beforeEach(() => vi.stubGlobal("crypto", webcrypto));
  afterEach(() => vi.unstubAllGlobals());

  it("accepts cue samples that match the displayed beat grid, regardless of analysis timestamp", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ mediaUrl: "/media/mixer.wav", cueRevision: revision })));
    await expect(fetchTrackMixer("track/id", { ...grid, analyzedAt: "2026-10-06T00:00:00Z" })).resolves.toBe("/media/mixer.wav");
    expect(fetch).toHaveBeenCalledWith("/api/tracks/track%2Fid/mixer");
  });

  it("rejects a response containing an obsolete beat grid", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ mediaUrl: "/media/mixer.wav", cueRevision: revision })));
    await expect(fetchTrackMixer("track", { ...grid, beats: [{ time: .75, position: 1, isDownbeat: true }] })).rejects.toBeInstanceOf(MixerCueRevisionError);
  });

  it("requests refreshed metadata when reanalysis changes during preparation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Beat grid is being rebuilt" }, { status: 409 })));
    await expect(fetchTrackMixer("track", grid)).rejects.toBeInstanceOf(MixerCueRevisionError);
  });
});
