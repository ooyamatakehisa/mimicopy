// @vitest-environment node
import express from "express";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { createFolderRouter } from "./folderRoutes.js";
import { createLibraryStore } from "./libraryStore.js";

it("validates folder API requests, moves tracks atomically and returns structured errors", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "mimicopy-folders-"));
  const store = createLibraryStore({
    databasePath: path.join(directory, "library.sqlite"),
    mediaDir: path.join(directory, "media")
  });
  const track = store.createTrack({
    title: "API song",
    sourceType: "upload",
    mediaFilename: "song.mp3",
    duration: 10
  });
  const app = express();
  app.use(express.json());
  app.use("/api", createFolderRouter(store));
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No test server port");
  const request = (url: string, method = "GET", body?: unknown) =>
    fetch(`http://127.0.0.1:${address.port}/api${url}`, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(method !== "GET" && body !== undefined
        ? { body: JSON.stringify(body) }
        : {})
    });
  try {
    for (const body of [
      {},
      { name: 3 },
      { name: "   " },
      { name: "x".repeat(81) }
    ]) {
      const response = await request("/folders", "POST", body);
      expect(response.status).toBe(400);
      expect(await response.json()).toHaveProperty("error");
    }
    const created = await request("/folders", "POST", { name: "Guitar" });
    expect(created.status).toBe(201);
    const { folder } = (await created.json()) as {
      folder: { id: string; name: string };
    };
    expect((await request("/folders", "POST", { name: "guitar" })).status).toBe(
      409
    );
    expect(
      (await request(`/folders/${folder.id}`, "PATCH", { name: "Practice" }))
        .status
    ).toBe(200);
    expect(await (await request("/folders")).json()).toEqual({
      folders: [{ id: folder.id, name: "Practice" }]
    });
    for (const body of [
      { trackIds: [] },
      { trackIds: [track.id] },
      { trackIds: [5], folderId: null },
      { trackIds: [track.id], folderId: 4 },
      { trackIds: Array(501).fill(track.id), folderId: null }
    ]) {
      expect((await request("/library/move", "PUT", body)).status).toBe(400);
    }
    expect(
      (
        await request("/library/move", "PUT", {
          trackIds: [track.id, "missing"],
          folderId: folder.id
        })
      ).status
    ).toBe(404);
    expect(store.getTrack(track.id)?.folderId).toBeNull();
    expect(
      (
        await request("/library/move", "PUT", {
          trackIds: [track.id],
          folderId: folder.id
        })
      ).status
    ).toBe(200);
    expect(store.getTrack(track.id)?.folderId).toBe(folder.id);
    expect((await request(`/folders/${folder.id}`, "DELETE")).status).toBe(200);
    expect(store.getTrack(track.id)?.folderId).toBeNull();
    expect((await request(`/folders/${folder.id}`, "DELETE")).status).toBe(404);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
