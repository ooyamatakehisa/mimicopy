export const playbackRates = [0.25, 0.5, 0.75, 1] as const;

export type PlaybackRate = (typeof playbackRates)[number];

export const defaultPlaybackRate: PlaybackRate = 1;

export function clampTime(value: number, duration: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  if (!Number.isFinite(duration) || duration <= 0) {
    return Math.max(0, value);
  }

  return Math.min(Math.max(0, value), duration);
}

export function seekBy(currentTime: number, deltaSeconds: number, duration: number) {
  return clampTime(currentTime + deltaSeconds, duration);
}

export function nextPlaybackRate(
  currentRate: number,
  direction: "faster" | "slower"
): PlaybackRate {
  const currentIndex = playbackRates.findIndex((rate) => rate === currentRate);
  const fallbackIndex = playbackRates.indexOf(defaultPlaybackRate);
  const safeIndex = currentIndex >= 0 ? currentIndex : fallbackIndex;
  const nextIndex =
    direction === "faster"
      ? Math.min(playbackRates.length - 1, safeIndex + 1)
      : Math.max(0, safeIndex - 1);

  return playbackRates[nextIndex];
}

export function formatTime(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  }

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function parseTimeInput(value: string, duration: number) {
  const parts = value
    .trim()
    .split(":")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0 || parts.length > 3) {
    return null;
  }

  const numbers = parts.map(Number);

  if (numbers.some((part) => !Number.isFinite(part) || part < 0)) {
    return null;
  }

  const seconds =
    numbers.length === 1
      ? numbers[0]
      : numbers.length === 2
        ? numbers[0] * 60 + numbers[1]
        : numbers[0] * 3600 + numbers[1] * 60 + numbers[2];

  return clampTime(seconds, duration);
}

export type ShortcutCommand =
  | { type: "togglePlayback" }
  | { type: "seek"; deltaSeconds: number }
  | { type: "speed"; direction: "faster" | "slower" }
  | { type: "addMarker" }
  | { type: "returnToMarker" };

type ShortcutEvent = {
  key: string;
  code?: string;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
};

export function getShortcutCommand(event: ShortcutEvent): ShortcutCommand | null {
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return null;
  }

  const key = event.key.toLowerCase();

  if (
    event.shiftKey &&
    (event.key === "." || event.key === ">" || event.code === "Period")
  ) {
    return { direction: "faster", type: "speed" };
  }

  if (
    event.shiftKey &&
    (event.key === "," || event.key === "<" || event.code === "Comma")
  ) {
    return { direction: "slower", type: "speed" };
  }

  if (event.key === " " || event.key === "Enter" || key === "k") {
    return { type: "togglePlayback" };
  }

  if (event.key === "ArrowLeft") {
    return { deltaSeconds: -5, type: "seek" };
  }

  if (event.key === "ArrowRight") {
    return { deltaSeconds: 5, type: "seek" };
  }

  if (key === "j") {
    return { deltaSeconds: -10, type: "seek" };
  }

  if (key === "l") {
    return { deltaSeconds: 10, type: "seek" };
  }

  if (key === "m") {
    return { type: "addMarker" };
  }

  if (event.key === "Delete" || event.key === "Backspace") {
    return { type: "returnToMarker" };
  }

  return null;
}
