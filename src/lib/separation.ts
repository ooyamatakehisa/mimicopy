export const stemNames = [
  "bass",
  "drums",
  "other",
  "vocals",
  "guitar",
  "piano"
] as const;

export type StemName = (typeof stemNames)[number];

export type SeparationStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed";

export type SeparationProgress = {
  completedSegments: number;
  estimatedRemainingSeconds: number | null;
  percentage: number;
  totalSegments: number;
};

export type TrackSeparation = {
  createdAt: string;
  error: string | null;
  mediaUrl: string | null;
  progress: SeparationProgress | null;
  remainderMediaUrl: string | null;
  status: SeparationStatus;
  targetStem: StemName;
  updatedAt: string;
};

export const stemLabels: Record<StemName, string> = {
  bass: "ベース",
  drums: "ドラム",
  guitar: "ギター",
  other: "その他",
  piano: "ピアノ",
  vocals: "ボーカル"
};

export function isStemName(value: unknown): value is StemName {
  return (
    typeof value === "string" &&
    stemNames.some((stemName) => stemName === value)
  );
}

export function formatEstimatedRemainingTime(seconds: number | null) {
  if (seconds === null) {
    return "残り時間を計算中";
  }

  const roundedSeconds = Math.max(0, Math.ceil(seconds));

  if (roundedSeconds === 0) {
    return "まもなく完了";
  }

  if (roundedSeconds < 60) {
    return `残り約${roundedSeconds}秒`;
  }

  const roundedMinutes = Math.ceil(roundedSeconds / 60);

  if (roundedMinutes < 60) {
    return `残り約${roundedMinutes}分`;
  }

  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;

  return minutes === 0
    ? `残り約${hours}時間`
    : `残り約${hours}時間${minutes}分`;
}
