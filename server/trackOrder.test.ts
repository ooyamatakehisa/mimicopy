// @vitest-environment node
import express from "express";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { createLibraryStore, type LibraryStore } from "./libraryStore.js";
import { createTrackOrderRouter } from "./trackOrderRoutes.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function setup() {
  const directory = await mkdtemp(path.join(tmpdir(), "mimicopy-order-"));
  const paths = { databasePath: path.join(directory, "library.sqlite"), mediaDir: path.join(directory, "media") };
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  return paths;
}
function add(store: LibraryStore, name: string) {
  return store.createTrack({ title: name, mediaFilename: `${name}.mp3`, sourceType: "upload", duration: 10 }).id;
}
const ids = (store: LibraryStore) => store.listTracks().map((track) => track.id);

it("migrates the visible order atomically and retains manual order after edits and reopening", async () => {
  const paths = await setup();
  const old = new DatabaseSync(paths.databasePath);
  old.exec(`CREATE TABLE tracks (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, source_type TEXT NOT NULL,
    media_filename TEXT NOT NULL UNIQUE, duration REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  ); INSERT INTO tracks VALUES
    ('a', 'A', 'upload', 'a.mp3', 10, '2026-01-01', '2026-01-01'),
    ('b', 'B', 'upload', 'b.mp3', 20, '2026-01-01', '2026-03-01'),
    ('c', 'C', 'upload', 'c.mp3', 30, '2026-01-01', '2026-02-01');`);
  old.close();
  const store = createLibraryStore(paths);
  expect(ids(store)).toEqual(["b", "c", "a"]);
  store.reorderTracks("all", ["b", "c", "a"], ["a", "b", "c"]);
  store.updateTrackTitle("c", "Renamed");
  store.replaceMarkers("b", [{ id: "cue", label: "Cue", time: 3 }]);
  expect(ids(store)).toEqual(["a", "b", "c"]);
  store.close();
  const reopened = createLibraryStore(paths);
  try {
    expect(ids(reopened)).toEqual(["a", "b", "c"]);
    expect(reopened.getTrack("b")?.markers).toHaveLength(1);
    const added = add(reopened, "new");
    expect(ids(reopened)).toEqual([added, "a", "b", "c"]);
  } finally { reopened.close(); }
});

it("reorders a folder without changing the relative order or metadata of other tracks", async () => {
  const store = createLibraryStore(await setup());
  try {
    const [a, b, c, d] = ["a", "b", "c", "d"].map((name) => add(store, name));
    const folder = store.saveFolder("Practice");
    store.moveTracks([a, c], folder.id);
    const before = store.listTracks();
    store.reorderTracks(`folder:${folder.id}`, [c, a], [a, c]);
    expect(ids(store)).toEqual([d, a, b, c]);
    expect(store.listTracks()).toEqual([before[0], before[3], before[2], before[1]]);
    store.reorderTracks("unfiled", [d, b], [b, d]);
    expect(ids(store)).toEqual([b, a, d, c]);
    store.deleteFolder(folder.id);
    expect(ids(store)).toEqual([b, a, d, c]);
    store.deleteTrack(a);
    expect(ids(store)).toEqual([b, d, c]);
  } finally { store.close(); }
});

it("rejects stale membership, order and invalid permutations without partial writes", async () => {
  const store = createLibraryStore(await setup());
  try {
    const [a, b, c] = ["a", "b", "c"].map((name) => add(store, name));
    const previous = [c, b, a];
    for (const invalid of [[a, a, c], [a, b], [a, b, "missing"]]) {
      expect(() => store.reorderTracks("all", previous, invalid)).toThrow("一致しません");
      expect(ids(store)).toEqual(previous);
    }
    store.reorderTracks("all", previous, [a, c, b]);
    expect(() => store.reorderTracks("all", previous, [b, c, a])).toThrow("変更されました");
    const folder = store.saveFolder("Other");
    store.moveTracks([a], folder.id);
    expect(() => store.reorderTracks("unfiled", [a, c, b], [b, c, a])).toThrow("変更されました");
    expect(() => store.reorderTracks("folder:missing", [a], [a])).toThrow("見つかりません");
    expect(ids(store)).toEqual([a, c, b]);
    const newId = add(store, "later");
    expect(() => store.reorderTracks("all", [a, c, b], [b, c, a])).toThrow("変更されました");
    expect(ids(store)).toEqual([newId, a, c, b]);
  } finally { store.close(); }
});

it("validates order requests and returns structured conflicts over HTTP", async () => {
  const store = createLibraryStore(await setup());
  const [a, b] = ["a", "b"].map((name) => add(store, name));
  const app = express();
  app.use(express.json({ strict: false }));
  app.use("/api", createTrackOrderRouter(store));
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No server address");
  const request = (body: unknown) => fetch(`http://127.0.0.1:${address.port}/api/library/order`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  const valid = { scope: "all", previousTrackIds: [b, a], trackIds: [a, b] };
  try {
    for (const body of [null, [], {}, { ...valid, scope: "folder:" }, { ...valid, scope: 1 },
      { ...valid, trackIds: [a, a] }, { ...valid, trackIds: [1] }, { ...valid, trackIds: [] },
      { ...valid, previousTrackIds: [b, b] }, { ...valid, trackIds: ["x".repeat(101)] }]) {
      const response = await request(body);
      expect(response.status).toBe(400);
      expect(await response.json()).toHaveProperty("error");
    }
    expect((await request(valid)).status).toBe(200);
    const conflict = await request(valid);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toHaveProperty("error");
    expect(ids(store)).toEqual([a, b]);
    expect((await request({ ...valid, scope: "folder:missing" })).status).toBe(404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    store.close();
  }
});
