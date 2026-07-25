export type BeatPoint = {
  time: number;
  position: number;
  isDownbeat: boolean;
};

export type BeatGrid = {
  analyzedAt: string;
  beats: BeatPoint[];
  beatsPerBar: number[];
  downbeats: number[];
  source: "madmom";
};

export type BeatAnalysisStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed";

export type TrackBeatAnalysis = {
  beatGrid: BeatGrid | null;
  createdAt: string;
  error: string | null;
  status: BeatAnalysisStatus;
  updatedAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readNumber(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function parseBeatPoint(value: unknown): BeatPoint | null {
  if (!isRecord(value)) {
    return null;
  }

  const time = readNumber(value, "time");
  const position = readNumber(value, "position");

  if (time === null || time < 0 || position === null || position < 1) {
    return null;
  }

  return {
    isDownbeat: value.isDownbeat === true,
    position: Math.round(position),
    time
  };
}

function parseBeatsPerBar(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }

  const beatsPerBar = value.filter(
    (candidate): candidate is number =>
      Number.isInteger(candidate) && candidate > 0
  );

  return beatsPerBar.length > 0 ? beatsPerBar : null;
}

export function parseBeatGrid(value: unknown): BeatGrid | null {
  if (!isRecord(value) || !Array.isArray(value.beats)) {
    return null;
  }

  const analyzedAt = readString(value, "analyzedAt");
  const source = readString(value, "source");
  const beatsPerBar = parseBeatsPerBar(value.beatsPerBar);

  if (!analyzedAt || source !== "madmom" || !beatsPerBar) {
    return null;
  }

  const beats: BeatPoint[] = [];

  for (const beatValue of value.beats) {
    const beat = parseBeatPoint(beatValue);

    if (!beat) {
      return null;
    }

    beats.push(beat);
  }

  const downbeats = beats
    .filter((beat) => beat.isDownbeat)
    .map((beat) => beat.time);

  return {
    analyzedAt,
    beats,
    beatsPerBar,
    downbeats,
    source
  };
}

export function parseTrackBeatAnalysisResponse(value: unknown) {
  if (!isRecord(value)) {
    throw new Error("拍解析結果を読み込めませんでした。");
  }

  const status = readString(value, "status");
  const createdAt = readString(value, "createdAt");
  const updatedAt = readString(value, "updatedAt");
  const error =
    value.error === null ? null : readString(value, "error");
  const beatGrid =
    value.beatGrid === null ? null : parseBeatGrid(value.beatGrid);

  if (
    (status !== "queued" &&
      status !== "running" &&
      status !== "completed" &&
      status !== "failed") ||
    !createdAt ||
    !updatedAt ||
    (error === null && value.error !== null) ||
    (status === "completed" ? !beatGrid : beatGrid !== null)
  ) {
    throw new Error("拍解析結果の形式が壊れています。");
  }

  return {
    beatGrid,
    createdAt,
    error,
    status,
    updatedAt
  } satisfies TrackBeatAnalysis;
}
