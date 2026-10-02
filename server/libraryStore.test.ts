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

  it.each(["madmom", "beat-this"] as const)("persists %s beat analysis across store instances", async (source) => {
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
      ...(source === "madmom"
        ? { source: "madmom" as const }
        : { source: "beat-this" as const, model: "final0" as const, postprocessor: "dbn" as const })
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

describe("library folders", () => {
  it("persists folder moves and preserves audio, markers and stems when deleting a folder", async () => {
    const paths = await createTempStorage();
    const store = createLibraryStore(paths);
    const track = store.createTrack({ title: "Practice", sourceType: "youtube", mediaFilename: "practice.mp3", duration: 120 });
    store.replaceMarkers(track.id, [{ id: "chorus", label: "Chorus", time: 30 }]);
    store.createSeparation({ trackId: track.id, targetStem: "guitar", mediaFilename: "guitar.mp3", remainderMediaFilename: "other.mp3" });
    const first = store.saveFolder("  Guitar  ");
    const second = store.saveFolder("Set list");
    store.moveTracks([track.id], first.id);
    expect(store.listTracks()[0]?.folderId).toBe(first.id);
    store.moveTracks([track.id], second.id);
    store.saveFolder("Live set", second.id);
    store.close();
    const reopened = createLibraryStore(paths);
    try {
      expect(reopened.listFolders()).toContainEqual({ id: second.id, name: "Live set" });
      expect(reopened.getTrack(track.id)?.folderId).toBe(second.id);
      reopened.deleteFolder(second.id);
      expect(reopened.getTrack(track.id)).toMatchObject({
        folderId: null, mediaUrl: track.mediaUrl,
        markers: [{ id: "chorus", label: "Chorus", time: 30 }],
        separation: { targetStem: "guitar", status: "queued" }
      });
      reopened.moveTracks([track.id], first.id);
      reopened.moveTracks([track.id], null);
      expect(reopened.getTrack(track.id)?.folderId).toBeNull();
    } finally { reopened.close(); await rm(path.dirname(paths.databasePath), { recursive: true, force: true }); }
  });

  it("rejects invalid folders and rolls back an entire batch if a track is missing", async () => {
    const paths = await createTempStorage();
    const store = createLibraryStore(paths);
    try {
      const track = store.createTrack({ title: "Song", sourceType: "upload", mediaFilename: "song.mp3", duration: 10 });
      const folder = store.saveFolder("Practice");
      expect(() => store.saveFolder(" practice ")).toThrow("同じ名前");
      expect(() => store.saveFolder(" \n ")).toThrow("1〜80文字");
      expect(() => store.saveFolder("a".repeat(81))).toThrow("1〜80文字");
      expect(() => store.saveFolder("a\0b")).toThrow("1〜80文字");
      expect(() => store.saveFolder("Rename", "missing")).toThrow("見つかりません");
      expect(() => store.moveTracks([track.id], "missing")).toThrow("移動先");
      expect(() => store.moveTracks([track.id, "missing"], folder.id)).toThrow("曲が見つかりません");
      expect(store.getTrack(track.id)?.folderId).toBeNull();
      expect(store.listFolders()).toEqual([folder]);
    } finally { store.close(); await rm(path.dirname(paths.databasePath), { recursive: true, force: true }); }
  });

  it("migrates an existing database without losing tracks and is safe to reopen", async () => {
    const paths = await createTempStorage();
    const old = new DatabaseSync(paths.databasePath);
    old.exec(`CREATE TABLE tracks (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, source_type TEXT NOT NULL,
      media_filename TEXT NOT NULL UNIQUE, duration REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ); INSERT INTO tracks VALUES ('old', 'Old song', 'upload', 'old.mp3', 30, '2026-01-01', '2026-01-01');`);
    old.close();
    const store = createLibraryStore(paths);
    expect(store.getTrack("old")).toMatchObject({ folderId: null, title: "Old song", duration: 30 });
    const folder = store.saveFolder("Migrated");
    store.moveTracks(["old"], folder.id);
    store.close();
    const reopened = createLibraryStore(paths);
    try { expect(reopened.getTrack("old")?.folderId).toBe(folder.id); }
    finally { reopened.close(); await rm(path.dirname(paths.databasePath), { recursive: true, force: true }); }
  });
});
