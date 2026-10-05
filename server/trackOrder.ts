import type { DatabaseSync } from "node:sqlite";

export class TrackOrderError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function migrateTrackOrder(database: DatabaseSync) {
  if (database.prepare("PRAGMA table_info(tracks)").all().some((column) => column.name === "sort_position")) return;
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec("ALTER TABLE tracks ADD COLUMN sort_position INTEGER NOT NULL DEFAULT 0");
    database.exec(`
      WITH positions AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY updated_at DESC, id) - 1 AS position
        FROM tracks
      )
      UPDATE tracks SET sort_position = (SELECT position FROM positions WHERE positions.id = tracks.id);
      CREATE INDEX tracks_sort_position_index ON tracks(sort_position);
    `);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function reorderTrackScope(
  database: DatabaseSync,
  scope: string,
  previousTrackIds: string[],
  trackIds: string[]
) {
  database.exec("BEGIN IMMEDIATE");
  try {
    if (scope.startsWith("folder:") && !database.prepare("SELECT id FROM folders WHERE id = ?").get(scope.slice(7))) {
      throw new TrackOrderError(404, "フォルダが見つかりません。一覧に戻って確認してください。");
    }
    const rows = database.prepare("SELECT id, folder_id, sort_position FROM tracks ORDER BY sort_position, id").all()
      .filter((row) => scope === "all" || row.folder_id === (scope === "unfiled" ? null : scope.slice(7)));
    if (rows.length !== previousTrackIds.length || rows.some((row, index) => row.id !== previousTrackIds[index])) {
      throw new TrackOrderError(409, "編集中に曲の一覧が変更されました。一覧に戻って、もう一度並べ替えてください。");
    }
    const existing = new Set(previousTrackIds);
    if (trackIds.length !== rows.length || new Set(trackIds).size !== rows.length || trackIds.some((id) => !existing.has(id))) {
      throw new TrackOrderError(400, "並べ替える曲が一覧と一致しません。");
    }
    const update = database.prepare("UPDATE tracks SET sort_position = ? WHERE id = ?");
    trackIds.forEach((id, index) => {
      const position = rows[index].sort_position;
      if (typeof position !== "number") throw new Error("Invalid track position");
      update.run(position, id);
    });
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
