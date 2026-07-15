import type { LibrarySourceType } from "../../lib/library";

const libraryDateFormatter = new Intl.DateTimeFormat("ja-JP", {
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  month: "numeric"
});

export function formatLibraryDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return libraryDateFormatter.format(date);
}

export function getSourceTypeLabel(sourceType: LibrarySourceType) {
  if (sourceType === "youtube") {
    return "YouTube";
  }

  if (sourceType === "imported") {
    return "Imported";
  }

  return "MP3";
}
