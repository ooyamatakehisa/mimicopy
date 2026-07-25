export const minTransposeSemitones = -6;
export const maxTransposeSemitones = 6;
export const defaultTransposeSemitones = 0;

export type TransposeDirection = "down" | "up";

export function clampTransposeSemitones(value: number) {
  if (!Number.isFinite(value)) {
    return defaultTransposeSemitones;
  }

  return Math.min(
    maxTransposeSemitones,
    Math.max(minTransposeSemitones, Math.round(value))
  );
}

export function stepTransposeSemitones(
  semitones: number,
  direction: TransposeDirection
) {
  return clampTransposeSemitones(semitones + (direction === "up" ? 1 : -1));
}

export function formatTransposeSemitones(semitones: number) {
  const clampedSemitones = clampTransposeSemitones(semitones);

  return clampedSemitones > 0
    ? `+${clampedSemitones}`
    : String(clampedSemitones);
}
