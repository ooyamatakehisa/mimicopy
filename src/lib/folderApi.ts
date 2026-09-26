import { parseJsonResponse } from "./api";
import { parseFolder } from "./folders";

export const foldersQueryKey = ["folders"] as const;

export async function fetchFolders() {
  const body = await parseJsonResponse(
    await fetch("/api/folders"),
    "フォルダを読み込めませんでした。"
  );
  if (
    !body ||
    typeof body !== "object" ||
    !("folders" in body) ||
    !Array.isArray(body.folders)
  ) {
    throw new Error("フォルダ一覧の形式が壊れています。");
  }
  return body.folders.map(parseFolder);
}

export async function saveFolder({
  name,
  folderId
}: {
  name: string;
  folderId?: string;
}) {
  const body = await parseJsonResponse(
    await fetch(
      folderId
        ? `/api/folders/${encodeURIComponent(folderId)}`
        : "/api/folders",
      {
        method: folderId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name })
      }
    ),
    "フォルダを保存できませんでした。"
  );
  return parseFolder(
    body && typeof body === "object" && "folder" in body ? body.folder : null
  );
}

export async function deleteFolder(folderId: string) {
  await parseJsonResponse(
    await fetch(`/api/folders/${encodeURIComponent(folderId)}`, {
      method: "DELETE"
    }),
    "フォルダを削除できませんでした。"
  );
}

export async function moveTracks(input: {
  trackIds: string[];
  folderId: string | null;
}) {
  await parseJsonResponse(
    await fetch("/api/library/move", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }),
    "曲を移動できませんでした。"
  );
}
