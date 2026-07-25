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

export type TrackSeparation = {
  createdAt: string;
  error: string | null;
  mediaUrl: string | null;
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
