// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
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
});
