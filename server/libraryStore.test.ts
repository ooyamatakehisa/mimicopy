// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
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

  it("persists an automatic beat analysis across store instances", async () => {
    const paths = await createTempStorage();
    const store = createLibraryStore(paths);
    const track = store.createTrack({
      duration: 0,
      mediaFilename: "phrase.mp3",
      sourceType: "upload",
      title: "phrase.mp3"
    });
    const beatGrid = {
      analyzedAt: "2026-07-20T00:00:00.000Z",
      beats: [
        { isDownbeat: true, position: 1, time: 0.25 },
        { isDownbeat: false, position: 2, time: 0.75 }
      ],
      beatsPerBar: [4],
      downbeats: [0.25],
      source: "madmom" as const
    };

    store.queueMissingBeatAnalyses();
    expect(store.getBeatAnalysis(track.id)).toMatchObject({
      beatGrid: null,
      error: null,
      status: "queued"
    });
    expect(store.listIncompleteBeatAnalyses()).toEqual([
      { inputFilename: "phrase.mp3", trackId: track.id }
    ]);
    store.updateBeatAnalysisStatus({ status: "running", trackId: track.id });
    store.completeBeatAnalysis(track.id, beatGrid);
    store.close();

    const reopenedStore = createLibraryStore(paths);

    expect(reopenedStore.getBeatAnalysis(track.id)).toMatchObject({
      beatGrid,
      error: null,
      status: "completed"
    });
    expect(reopenedStore.listIncompleteBeatAnalyses()).toEqual([]);
    reopenedStore.close();
  });

  it("persists one stem separation and exposes media only when completed", async () => {
    const paths = await createTempStorage();
    const store = createLibraryStore(paths);
    const track = store.createTrack({
      duration: 10,
      mediaFilename: "phrase.mp3",
      sourceType: "youtube",
      title: "phrase.mp3"
    });

    const queuedTrack = store.createSeparation({
      mediaFilename: "phrase-guitar.mp3",
      remainderMediaFilename: "phrase-guitar-remainder.mp3",
      targetStem: "guitar",
      trackId: track.id
    });

    expect(queuedTrack?.separation).toMatchObject({
      mediaUrl: null,
      progress: null,
      remainderMediaUrl: null,
      status: "queued",
      targetStem: "guitar"
    });
    expect(store.listIncompleteSeparations()).toEqual([
      {
        inputFilename: "phrase.mp3",
        outputFilename: "phrase-guitar.mp3",
        remainderOutputFilename: "phrase-guitar-remainder.mp3",
        targetStem: "guitar",
        trackId: track.id
      }
    ]);

    store.updateSeparationStatus({
      status: "running",
      trackId: track.id
    });
    const runningTrack = store.updateSeparationProgress({
      completedSegments: 2,
      estimatedRemainingSeconds: 18.5,
      totalSegments: 5,
      trackId: track.id
    });

    expect(runningTrack?.separation?.progress).toEqual({
      completedSegments: 2,
      estimatedRemainingSeconds: 18.5,
      percentage: 40,
      totalSegments: 5
    });

    const completedTrack = store.updateSeparationStatus({
      status: "completed",
      trackId: track.id
    });

    expect(completedTrack?.separation).toMatchObject({
      mediaUrl: "/media/phrase-guitar.mp3",
      progress: {
        completedSegments: 5,
        estimatedRemainingSeconds: 0,
        percentage: 100,
        totalSegments: 5
      },
      remainderMediaUrl: "/media/phrase-guitar-remainder.mp3",
      status: "completed",
      targetStem: "guitar"
    });
    store.close();

    const reopenedStore = createLibraryStore(paths);

    expect(reopenedStore.getTrack(track.id)?.separation).toMatchObject({
      mediaUrl: "/media/phrase-guitar.mp3",
      progress: {
        completedSegments: 5,
        estimatedRemainingSeconds: 0,
        percentage: 100,
        totalSegments: 5
      },
      remainderMediaUrl: "/media/phrase-guitar-remainder.mp3",
      status: "completed",
      targetStem: "guitar"
    });
    reopenedStore.close();
  });

  it("migrates existing separations and queues their missing remainder", async () => {
    const paths = await createTempStorage();
    await mkdir(paths.mediaDir, { recursive: true });
    const database = new DatabaseSync(paths.databasePath);
    database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE tracks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        source_type TEXT NOT NULL,
        media_filename TEXT NOT NULL UNIQUE,
        duration REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE track_separations (
        track_id TEXT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
        target_stem TEXT NOT NULL,
        status TEXT NOT NULL,
        media_filename TEXT NOT NULL UNIQUE,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO tracks VALUES (
        'track-1',
        'Phrase',
        'youtube',
        'phrase.mp3',
        10,
        '2026-07-20T00:00:00.000Z',
        '2026-07-20T00:00:00.000Z'
      );
      INSERT INTO track_separations VALUES (
        'track-1',
        'guitar',
        'completed',
        'phrase-guitar.mp3',
        NULL,
        '2026-07-20T00:00:00.000Z',
        '2026-07-20T00:00:00.000Z'
      );
    `);
    database.close();

    const store = createLibraryStore(paths);
    const separation = store.getTrack("track-1")?.separation;
    const queued = store.listIncompleteSeparations();

    expect(separation).toMatchObject({
      mediaUrl: null,
      remainderMediaUrl: null,
      status: "queued",
      targetStem: "guitar"
    });
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      inputFilename: "phrase.mp3",
      outputFilename: "phrase-guitar.mp3",
      targetStem: "guitar",
      trackId: "track-1"
    });
    expect(queued[0]?.remainderOutputFilename).toMatch(
      /-guitar-remainder\.mp3$/
    );
    store.close();
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

  it("keeps all separation outputs out of standalone library tracks", async () => {
    const paths = await createTempStorage();
    const stemFilename = "phrase-guitar.mp3";
    const remainderFilename = "phrase-guitar-remainder.mp3";
    const store = createLibraryStore(paths);
    const track = store.createTrack({
      duration: 10,
      mediaFilename: "phrase.mp3",
      sourceType: "youtube",
      title: "Phrase"
    });

    store.createSeparation({
      mediaFilename: stemFilename,
      remainderMediaFilename: remainderFilename,
      targetStem: "guitar",
      trackId: track.id
    });
    store.createTrack({
      duration: 0,
      mediaFilename: stemFilename,
      sourceType: "imported",
      title: stemFilename
    });
    store.createTrack({
      duration: 0,
      mediaFilename: remainderFilename,
      sourceType: "imported",
      title: remainderFilename
    });
    expect(store.listTracks()).toHaveLength(3);
    await writeFile(
      path.join(paths.mediaDir, stemFilename),
      new Uint8Array()
    );
    await writeFile(
      path.join(paths.mediaDir, remainderFilename),
      new Uint8Array()
    );
    store.close();

    const reopenedStore = createLibraryStore(paths);

    expect(reopenedStore.listTracks()).toEqual([
      expect.objectContaining({
        id: track.id,
        title: "Phrase"
      })
    ]);
    reopenedStore.close();
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
