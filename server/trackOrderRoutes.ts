import { Router } from "express";
import type { LibraryStore } from "./libraryStore.js";
import { TrackOrderError } from "./trackOrder.js";

function readIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(
    (id) => typeof id === "string" && id.length > 0 && id.length <= 100
  ) && new Set(value).size === value.length;
}

export function createTrackOrderRouter(store: LibraryStore) {
  const router = Router();
  router.put("/library/order", (request, response) => {
    try {
      const body: unknown = request.body;
      if (!body || typeof body !== "object" || !("scope" in body) || !("trackIds" in body) || !("previousTrackIds" in body) ||
        typeof body.scope !== "string" || !/^(all|unfiled|folder:.{1,100})$/.test(body.scope) ||
        !readIds(body.trackIds) || !readIds(body.previousTrackIds)) {
        throw new TrackOrderError(400, "並べ替える一覧と曲を指定してください。");
      }
      store.reorderTracks(body.scope, body.previousTrackIds, body.trackIds);
      response.json({ ok: true });
    } catch (error) {
      response.status(error instanceof TrackOrderError ? error.status : 500).json({
        error: error instanceof TrackOrderError ? error.message : "曲順を保存できませんでした。もう一度お試しください。"
      });
    }
  });
  return router;
}
