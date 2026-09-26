import type { TrackSummary } from "./library";

export type LibraryFolder = { id: string; name: string };
export type LibraryScope = "all" | "unfiled" | `folder:${string}`;

export function parseFolder(value: unknown): LibraryFolder {
  if (
    !value ||
    typeof value !== "object" ||
    !("id" in value) ||
    !("name" in value) ||
    typeof value.id !== "string" ||
    !value.id ||
    typeof value.name !== "string" ||
    !value.name.trim()
  ) {
    throw new Error(
      "フォルダ情報を読み込めませんでした。一覧を更新してください。"
    );
  }
  return { id: value.id, name: value.name };
}

export function filterLibraryTracks(
  tracks: TrackSummary[],
  scope: LibraryScope,
  search: string
) {
  const query = search.trim().normalize("NFKC").toLocaleLowerCase();
  return tracks.filter(
    (track) =>
      (scope === "all" ||
        (scope === "unfiled"
          ? track.folderId === null
          : track.folderId === scope.slice(7))) &&
      track.title.normalize("NFKC").toLocaleLowerCase().includes(query)
  );
}
