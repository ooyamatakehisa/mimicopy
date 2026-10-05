import { parseJsonResponse } from "./api";
import type { LibraryScope } from "./folders";

export async function saveTrackOrder(input: {
  scope: LibraryScope;
  previousTrackIds: string[];
  trackIds: string[];
}) {
  await parseJsonResponse(await fetch("/api/library/order", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  }), "曲順を保存できませんでした。もう一度お試しください。");
}
