// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import type { LibraryClickTrack } from "./libraryStore.js";
import { createLibraryStore } from "./libraryStore.js";

let tempDirs: string[] = [];

async function createTempStorage() {
  const storageDir = await mkdtemp(path.join(tmpdir(), "mimicopy-"));
  tempDirs.push(storageDir);

  return {
    databasePath: path.join(storageDir, "library.sqlite"),
    mediaDir: path.join(storageDir, "media")
  };
}

describe("LibraryStore", () => {
  afterEach(async () => {
    const dirs = tempDirs;
    tempDirs = [];

    await Promise.all(
      dirs.map((dir) => rm(dir, { force: true, recursive: true }))
    );
  });

  it("persists tracks and markers across store instances", async () => {
    const paths = await createTempStorage();
    const store = createLibraryStore(paths);
    const track = store.createTrack({
      duration: 0,
      mediaFilename: "phrase.mp3",
      sourceType: "upload",
      title: "phrase.mp3"
    });

    store.replaceMarkers(track.id, [
      { id: "marker-1", label: "Verse", time: 12.5 }
    ]);
    store.close();

    const reopenedStore = createLibraryStore(paths);
    const persistedTrack = reopenedStore.getTrack(track.id);

    expect(persistedTrack?.markers).toEqual([
      { id: "marker-1", label: "Verse", time: 12.5 }
    ]);
    reopenedStore.close();
  });

  it("persists a click track across store instances", async () => {
    const paths = await createTempStorage();
    const store = createLibraryStore(paths);
    const track = store.createTrack({
      duration: 0,
      mediaFilename: "phrase.mp3",
      sourceType: "upload",
      title: "phrase.mp3"
    });
    const clickTrack: LibraryClickTrack = {
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
      reference: {
        duration: 12,
        sourceType: "youtube",
        title: "Reference groove",
        url: "https://www.youtube.com/watch?v=DFRdswY-WHU"
      }
    };

    expect(store.replaceClickTrack(track.id, clickTrack)).toEqual(clickTrack);
    store.close();

    const reopenedStore = createLibraryStore(paths);

    expect(reopenedStore.getClickTrack(track.id)).toEqual(clickTrack);
    reopenedStore.close();
  });

  it("imports existing mp3 files from the media directory", async () => {
    const paths = await createTempStorage();

    await mkdir(paths.mediaDir, { recursive: true });
    await writeFile(path.join(paths.mediaDir, "legacy.mp3"), new Uint8Array());

    const store = createLibraryStore(paths);
    const tracks = store.listTracks();

    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({
      mediaUrl: "/media/legacy.mp3",
      sourceType: "imported",
      title: "legacy.mp3"
    });
    store.close();
  });

  it("updates track display titles", async () => {
    const paths = await createTempStorage();
    const store = createLibraryStore(paths);
    const track = store.createTrack({
      duration: 0,
      mediaFilename: "phrase.mp3",
      sourceType: "upload",
      title: "phrase.mp3"
    });

    const updatedTrack = store.updateTrackTitle(track.id, "Shadowing drill");

    expect(updatedTrack?.title).toBe("Shadowing drill");
    store.close();

    const reopenedStore = createLibraryStore(paths);

    expect(reopenedStore.getTrack(track.id)?.title).toBe("Shadowing drill");
    reopenedStore.close();
  });
});
