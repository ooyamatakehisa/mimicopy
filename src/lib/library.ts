import { sortMarkers, type Marker } from "./markers";

export type LibrarySourceType = "upload" | "youtube" | "imported";

export type TrackSummary = {
  id: string;
  title: string;
  sourceType: LibrarySourceType;
  mediaUrl: string;
  duration: number;
  markerCount: number;
  createdAt: string;
  updatedAt: string;
};

export type TrackDetail = TrackSummary & {
  markers: Marker[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function readNumber(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isSourceType(value: string): value is LibrarySourceType {
  return value === "upload" || value === "youtube" || value === "imported";
}

export function parseTrackSummary(value: unknown): TrackSummary | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value, "id");
  const title = readString(value, "title");
  const sourceType = readString(value, "sourceType");
  const mediaUrl = readString(value, "mediaUrl");
  const duration = readNumber(value, "duration");
  const markerCount = readNumber(value, "markerCount");
  const createdAt = readString(value, "createdAt");
  const updatedAt = readString(value, "updatedAt");

  if (
    !id ||
    !title ||
    !sourceType ||
    !isSourceType(sourceType) ||
    !mediaUrl ||
    duration === null ||
    markerCount === null ||
    !createdAt ||
    !updatedAt
  ) {
    return null;
  }

  return {
    createdAt,
    duration,
    id,
    markerCount,
    mediaUrl,
    sourceType,
    title,
    updatedAt
  };
}

export function parseMarker(value: unknown): Marker | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value, "id");
  const label = readString(value, "label");
  const time = readNumber(value, "time");

  if (!id || !label || time === null || time < 0) {
    return null;
  }

  return { id, label, time };
}

export function parseTrackDetail(value: unknown): TrackDetail | null {
  const summary = parseTrackSummary(value);

  if (!summary || !isRecord(value) || !Array.isArray(value.markers)) {
    return null;
  }

  const markers: Marker[] = [];

  for (const markerValue of value.markers) {
    const marker = parseMarker(markerValue);

    if (!marker) {
      return null;
    }

    markers.push(marker);
  }

  return {
    ...summary,
    markers: sortMarkers(markers)
  };
}

export function parseTrackListResponse(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.tracks)) {
    throw new Error("ライブラリ一覧を読み込めませんでした。");
  }

  const tracks: TrackSummary[] = [];

  for (const trackValue of value.tracks) {
    const track = parseTrackSummary(trackValue);

    if (!track) {
      throw new Error("ライブラリ一覧の形式が壊れています。");
    }

    tracks.push(track);
  }

  return tracks;
}

export function parseTrackResponse(value: unknown) {
  if (!isRecord(value)) {
    throw new Error("曲情報を読み込めませんでした。");
  }

  const track = parseTrackDetail(value.track);

  if (!track) {
    throw new Error("曲情報の形式が壊れています。");
  }

  return track;
}

export function getErrorMessage(value: unknown, fallback: string) {
  if (isRecord(value) && typeof value.error === "string") {
    return value.error;
  }

  return fallback;
}
