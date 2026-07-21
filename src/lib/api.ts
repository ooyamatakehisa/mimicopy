import type { Marker } from "./markers";
import { parseBeatGridResponse } from "./beats";
import {
  getErrorMessage,
  parseTrackListResponse,
  parseTrackResponse
} from "./library";

export const tracksQueryKey = ["tracks"] as const;

export function trackQueryKey(trackId: string) {
  return ["track", trackId] as const;
}

export function decodedTrackQueryKey(trackId: string, mediaUrl: string) {
  return ["track", trackId, "decoded", mediaUrl] as const;
}

export function beatGridQueryKey(trackId: string) {
  return ["track", trackId, "beat-grid"] as const;
}

async function parseJsonResponse(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    throw new Error(getErrorMessage(body, fallback));
  }

  return body;
}

export async function fetchTracks() {
  const response = await fetch("/api/tracks");
  const body = await parseJsonResponse(
    response,
    "ライブラリ一覧を読み込めませんでした。"
  );

  return parseTrackListResponse(body);
}

export async function fetchTrack(trackId: string) {
  const response = await fetch(`/api/tracks/${encodeURIComponent(trackId)}`);
  const body = await parseJsonResponse(
    response,
    "保存済みMP3を読み込めませんでした。"
  );

  return parseTrackResponse(body);
}

export async function uploadTrack(file: File) {
  const response = await fetch("/api/tracks", {
    body: file,
    headers: {
      "Content-Type": file.type || "audio/mpeg",
      "X-File-Name": encodeURIComponent(file.name)
    },
    method: "POST"
  });
  const body = await parseJsonResponse(response, "MP3を保存できませんでした。");

  return parseTrackResponse(body);
}

export async function convertYoutubeUrl(url: string) {
  const response = await fetch("/api/youtube", {
    body: JSON.stringify({ url }),
    headers: { "Content-Type": "application/json" },
    method: "POST"
  });
  const body = await parseJsonResponse(
    response,
    "YouTube変換に失敗しました。"
  );

  return parseTrackResponse(body);
}

export async function updateTrackDuration({
  duration,
  trackId
}: {
  duration: number;
  trackId: string;
}) {
  const response = await fetch(`/api/tracks/${encodeURIComponent(trackId)}`, {
    body: JSON.stringify({ duration }),
    headers: { "Content-Type": "application/json" },
    method: "PATCH"
  });
  const body = await parseJsonResponse(
    response,
    "曲の長さを保存できませんでした。"
  );

  return parseTrackResponse(body);
}

export async function updateTrackTitle({
  title,
  trackId
}: {
  title: string;
  trackId: string;
}) {
  const response = await fetch(`/api/tracks/${encodeURIComponent(trackId)}`, {
    body: JSON.stringify({ title }),
    headers: { "Content-Type": "application/json" },
    method: "PATCH"
  });
  const body = await parseJsonResponse(
    response,
    "表示名を保存できませんでした。"
  );

  return parseTrackResponse(body);
}

export async function saveTrackMarkers({
  markers,
  trackId
}: {
  markers: Marker[];
  trackId: string;
}) {
  const response = await fetch(
    `/api/tracks/${encodeURIComponent(trackId)}/markers`,
    {
      body: JSON.stringify({
        markers: markers.map((marker) => ({
          id: marker.id,
          label: marker.label.trim() || "Marker",
          time: marker.time
        }))
      }),
      headers: { "Content-Type": "application/json" },
      method: "PUT"
    }
  );
  const body = await parseJsonResponse(
    response,
    "マーカーを保存できませんでした。"
  );

  return parseTrackResponse(body);
}

export async function deleteTrack(trackId: string) {
  const response = await fetch(`/api/tracks/${encodeURIComponent(trackId)}`, {
    method: "DELETE"
  });

  await parseJsonResponse(response, "保存済みMP3を削除できませんでした。");
}

export async function analyzeTrackBeatGrid(trackId: string) {
  const response = await fetch(
    `/api/tracks/${encodeURIComponent(trackId)}/beat-grid`,
    {
      method: "POST"
    }
  );
  const body = await parseJsonResponse(response, "拍解析に失敗しました。");

  return parseBeatGridResponse(body);
}

export async function fetchMediaArrayBuffer(
  mediaUrl: string,
  fallback: string
) {
  const response = await fetch(mediaUrl);

  if (!response.ok) {
    throw new Error(fallback);
  }

  return response.arrayBuffer();
}
