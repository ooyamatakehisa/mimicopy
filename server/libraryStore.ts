import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type LibrarySourceType = "upload" | "youtube" | "imported";

export type LibraryMarker = {
  id: string;
  label: string;
  time: number;
};

export type LibraryTrackSummary = {
  id: string;
  title: string;
  sourceType: LibrarySourceType;
  mediaUrl: string;
  duration: number;
  markerCount: number;
  createdAt: string;
  updatedAt: string;
};

export type LibraryTrack = LibraryTrackSummary & {
  markers: LibraryMarker[];
};

type CreateTrackInput = {
  title: string;
  sourceType: LibrarySourceType;
  mediaFilename: string;
  duration: number;
  createdAt?: string;
  updatedAt?: string;
};

type LibraryStoreOptions = {
  databasePath: string;
  mediaDir: string;
};

function requireString(row: Record<string, unknown>, key: string) {
  const value = row[key];

  if (typeof value !== "string") {
    throw new Error(`Invalid library row: ${key} is missing.`);
  }

  return value;
}

function toFiniteNumber(value: unknown, fallback = 0) {
  const numberValue =
    typeof value === "bigint" ? Number(value) : Number(value ?? fallback);

  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function toSourceType(value: string): LibrarySourceType {
  if (value === "upload" || value === "youtube" || value === "imported") {
    return value;
  }

  return "imported";
}

function toMediaUrl(mediaFilename: string) {
  return `/media/${encodeURIComponent(mediaFilename)}`;
}

function normalizeDisplayTitle(title: string) {
  const cleanTitle = title.replaceAll("\0", "").trim();

  return cleanTitle.length > 0 ? cleanTitle.slice(0, 180) : "Untitled MP3";
}

function normalizeTitle(title: string) {
  const baseName = path.basename(title.replaceAll("\\", "/"));

  return normalizeDisplayTitle(baseName);
}

function rowToTrackSummary(row: Record<string, unknown>): LibraryTrackSummary {
  const mediaFilename = requireString(row, "media_filename");

  return {
    createdAt: requireString(row, "created_at"),
    duration: toFiniteNumber(row.duration),
    id: requireString(row, "id"),
    markerCount: toFiniteNumber(row.marker_count),
    mediaUrl: toMediaUrl(mediaFilename),
    sourceType: toSourceType(requireString(row, "source_type")),
    title: requireString(row, "title"),
    updatedAt: requireString(row, "updated_at")
  };
}

function rowToMarker(row: Record<string, unknown>): LibraryMarker {
  return {
    id: requireString(row, "id"),
    label: requireString(row, "label"),
    time: toFiniteNumber(row.time)
  };
}

function createSchema(database: DatabaseSync) {
  database.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      source_type TEXT NOT NULL,
      media_filename TEXT NOT NULL UNIQUE,
      duration REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS markers (
      id TEXT PRIMARY KEY,
      track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      time REAL NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS markers_track_time_index
      ON markers(track_id, time);
  `);
}

export class LibraryStore {
  readonly mediaDir: string;

  #database: DatabaseSync;

  constructor(options: LibraryStoreOptions) {
    mkdirSync(path.dirname(options.databasePath), { recursive: true });
    mkdirSync(options.mediaDir, { recursive: true });

    this.mediaDir = options.mediaDir;
    this.#database = new DatabaseSync(options.databasePath);
    createSchema(this.#database);
  }

  close() {
    this.#database.close();
  }

  listTracks() {
    const rows = this.#database
      .prepare(
        `
          SELECT
            tracks.id,
            tracks.title,
            tracks.source_type,
            tracks.media_filename,
            tracks.duration,
            tracks.created_at,
            tracks.updated_at,
            COUNT(markers.id) AS marker_count
          FROM tracks
          LEFT JOIN markers ON markers.track_id = tracks.id
          GROUP BY tracks.id
          ORDER BY tracks.updated_at DESC
        `
      )
      .all();

    return rows.map(rowToTrackSummary);
  }

  getTrack(trackId: string) {
    const row = this.#database
      .prepare(
        `
          SELECT
            tracks.id,
            tracks.title,
            tracks.source_type,
            tracks.media_filename,
            tracks.duration,
            tracks.created_at,
            tracks.updated_at,
            COUNT(markers.id) AS marker_count
          FROM tracks
          LEFT JOIN markers ON markers.track_id = tracks.id
          WHERE tracks.id = ?
          GROUP BY tracks.id
        `
      )
      .get(trackId);

    if (!row) {
      return null;
    }

    return {
      ...rowToTrackSummary(row),
      markers: this.getMarkers(trackId)
    };
  }

  getMediaFilename(trackId: string) {
    const row = this.#database
      .prepare("SELECT media_filename FROM tracks WHERE id = ?")
      .get(trackId);

    return row ? requireString(row, "media_filename") : null;
  }

  createTrack(input: CreateTrackInput) {
    const id = randomUUID();
    const now = new Date().toISOString();
    const createdAt = input.createdAt ?? now;
    const updatedAt = input.updatedAt ?? now;

    this.#database
      .prepare(
        `
          INSERT INTO tracks (
            id,
            title,
            source_type,
            media_filename,
            duration,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        id,
        normalizeTitle(input.title),
        input.sourceType,
        input.mediaFilename,
        Math.max(0, input.duration),
        createdAt,
        updatedAt
      );

    const track = this.getTrack(id);

    if (!track) {
      throw new Error("Created track could not be loaded.");
    }

    return track;
  }

  updateTrackDuration(trackId: string, duration: number) {
    const now = new Date().toISOString();

    this.#database
      .prepare(
        `
          UPDATE tracks
          SET duration = ?, updated_at = ?
          WHERE id = ?
        `
      )
      .run(Math.max(0, duration), now, trackId);

    return this.getTrack(trackId);
  }

  updateTrackTitle(trackId: string, title: string) {
    const now = new Date().toISOString();

    this.#database
      .prepare(
        `
          UPDATE tracks
          SET title = ?, updated_at = ?
          WHERE id = ?
        `
      )
      .run(normalizeDisplayTitle(title), now, trackId);

    return this.getTrack(trackId);
  }

  replaceMarkers(trackId: string, markers: LibraryMarker[]) {
    if (!this.getTrack(trackId)) {
      return null;
    }

    const now = new Date().toISOString();
    const deleteMarkers = this.#database.prepare(
      "DELETE FROM markers WHERE track_id = ?"
    );
    const insertMarker = this.#database.prepare(
      `
        INSERT INTO markers (
          id,
          track_id,
          label,
          time,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `
    );
    const updateTrack = this.#database.prepare(
      "UPDATE tracks SET updated_at = ? WHERE id = ?"
    );

    try {
      this.#database.exec("BEGIN IMMEDIATE");
      deleteMarkers.run(trackId);

      for (const marker of markers) {
        insertMarker.run(
          marker.id,
          trackId,
          marker.label.trim() || "Marker",
          Math.max(0, marker.time),
          now,
          now
        );
      }

      updateTrack.run(now, trackId);
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }

    return this.getTrack(trackId);
  }

  deleteTrack(trackId: string) {
    const mediaFilename = this.getMediaFilename(trackId);

    if (!mediaFilename) {
      return null;
    }

    this.#database.prepare("DELETE FROM tracks WHERE id = ?").run(trackId);

    return mediaFilename;
  }

  importExistingMedia() {
    if (!existsSync(this.mediaDir)) {
      return;
    }

    const selectTrack = this.#database.prepare(
      "SELECT id FROM tracks WHERE media_filename = ?"
    );

    for (const entry of readdirSync(this.mediaDir, { withFileTypes: true })) {
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".mp3") {
        continue;
      }

      if (selectTrack.get(entry.name)) {
        continue;
      }

      const filePath = path.join(this.mediaDir, entry.name);
      const stats = statSync(filePath);
      const timestamp = stats.mtime.toISOString();

      this.createTrack({
        createdAt: timestamp,
        duration: 0,
        mediaFilename: entry.name,
        sourceType: "imported",
        title: entry.name,
        updatedAt: timestamp
      });
    }
  }

  private getMarkers(trackId: string) {
    const rows = this.#database
      .prepare(
        `
          SELECT id, label, time
          FROM markers
          WHERE track_id = ?
          ORDER BY time ASC
        `
      )
      .all(trackId);

    return rows.map(rowToMarker);
  }
}

export function createLibraryStore(options: LibraryStoreOptions) {
  const store = new LibraryStore(options);
  store.importExistingMedia();

  return store;
}
