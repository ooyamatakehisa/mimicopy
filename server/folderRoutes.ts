import { Router, type Response } from "express";
import { LibraryFolderError, type LibraryStore } from "./libraryStore.js";

function readBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LibraryFolderError(400, "入力内容を確認してください。");
  }
  return value as Record<string, unknown>;
}

function readName(body: unknown) {
  const { name } = readBody(body);
  if (typeof name !== "string") {
    throw new LibraryFolderError(400, "フォルダ名を入力してください。");
  }
  return name;
}

function sendFolderError(response: Response, error: unknown) {
  response
    .status(error instanceof LibraryFolderError ? error.status : 500)
    .json({
      error:
        error instanceof LibraryFolderError
          ? error.message
          : "フォルダを更新できませんでした。もう一度お試しください。"
    });
}

export function createFolderRouter(store: LibraryStore) {
  const router = Router();
  router.get("/folders", (_request, response) => {
    try {
      response.json({ folders: store.listFolders() });
    } catch (error) {
      sendFolderError(response, error);
    }
  });
  router.post("/folders", (request, response) => {
    try {
      response
        .status(201)
        .json({ folder: store.saveFolder(readName(request.body)) });
    } catch (error) {
      sendFolderError(response, error);
    }
  });
  router.patch("/folders/:folderId", (request, response) => {
    try {
      response.json({
        folder: store.saveFolder(
          readName(request.body),
          request.params.folderId
        )
      });
    } catch (error) {
      sendFolderError(response, error);
    }
  });
  router.delete("/folders/:folderId", (request, response) => {
    try {
      store.deleteFolder(request.params.folderId);
      response.json({ ok: true });
    } catch (error) {
      sendFolderError(response, error);
    }
  });
  router.put("/library/move", (request, response) => {
    try {
      const { trackIds, folderId } = readBody(request.body);
      if (
        !Array.isArray(trackIds) ||
        trackIds.length === 0 ||
        trackIds.length > 500 ||
        !trackIds.every(
          (id): id is string =>
            typeof id === "string" && id.length > 0 && id.length <= 100
        ) ||
        (folderId !== null &&
          (typeof folderId !== "string" || !folderId || folderId.length > 100))
      ) {
        throw new LibraryFolderError(
          400,
          "移動する曲と移動先を指定してください（一度に500曲まで）。"
        );
      }
      store.moveTracks([...new Set(trackIds)], folderId);
      response.json({ ok: true });
    } catch (error) {
      sendFolderError(response, error);
    }
  });
  return router;
}
