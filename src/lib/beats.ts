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

export type BeatGridReference = {
  duration: number;
  sourceType: "youtube";
  title: string;
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

function parseBeatGridReference(value: unknown): BeatGridReference | null {
  if (!isRecord(value)) {
    return null;
  }

  const duration = readNumber(value, "duration");
  const sourceType = readString(value, "sourceType");
  const title = readString(value, "title");

  if (
    duration === null ||
    duration < 0 ||
    sourceType !== "youtube" ||
    !title
  ) {
    return null;
  }

  return {
    duration,
    sourceType,
    title
  };
}

export function parseBeatGridResponse(value: unknown) {
  if (!isRecord(value)) {
    throw new Error("拍解析結果を読み込めませんでした。");
  }

  const beatGrid = parseBeatGrid(value.beatGrid);

  if (!beatGrid) {
    throw new Error("拍解析結果の形式が壊れています。");
  }

  return beatGrid;
}

export function parseYoutubeBeatGridResponse(value: unknown) {
  if (!isRecord(value)) {
    throw new Error("拍解析結果を読み込めませんでした。");
  }

  const beatGrid = parseBeatGrid(value.beatGrid);
  const reference = parseBeatGridReference(value.reference);

  if (!beatGrid || !reference) {
    throw new Error("拍解析結果の形式が壊れています。");
  }

  return { beatGrid, reference };
}
