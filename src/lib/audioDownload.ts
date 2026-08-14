import type { StemName } from "./separation";

export type TrackAudioDownloadKind = "original" | "remainder" | "stem";

function getSafeDownloadBaseName(trackTitle: string) {
  const baseName = trackTitle
    .trim()
    .replace(/\.mp3$/i, "")
    .replace(/\p{Cc}/gu, "-")
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[.\s-]+$/g, "")
    .trim();

  return baseName || "audio";
}

export function getTrackAudioDownloadFilename(
  trackTitle: string,
  kind: TrackAudioDownloadKind,
  targetStem: StemName
) {
  const baseName = getSafeDownloadBaseName(trackTitle);

  if (kind === "stem") {
    return `${baseName}-${targetStem}.mp3`;
  }

  if (kind === "remainder") {
    return `${baseName}-${targetStem}-remainder.mp3`;
  }

  return `${baseName}.mp3`;
}
