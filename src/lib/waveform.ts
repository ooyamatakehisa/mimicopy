export type WaveformPeak = {
  min: number;
  max: number;
};

export const waveformZoomLevels = [1, 2, 4, 8, 16] as const;

export type WaveformZoom = (typeof waveformZoomLevels)[number];

export type WaveformRange = {
  end: number;
  start: number;
};

export const defaultWaveformZoom: WaveformZoom = 1;

type PeakSource = {
  duration: number;
  length: number;
  numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
};

export function buildWaveformPeaks(
  source: PeakSource,
  sampleCount: number
): WaveformPeak[] {
  const peakCount = Math.max(1, Math.floor(sampleCount));
  const blockSize = Math.max(1, Math.floor(source.length / peakCount));
  const peaks: WaveformPeak[] = [];

  for (let peakIndex = 0; peakIndex < peakCount; peakIndex += 1) {
    const start = peakIndex * blockSize;
    const end = Math.min(source.length, start + blockSize);
    let min = 1;
    let max = -1;

    for (let channel = 0; channel < source.numberOfChannels; channel += 1) {
      const data = source.getChannelData(channel);

      for (let index = start; index < end; index += 1) {
        const value = data[index] ?? 0;
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    }

    peaks.push({
      max: Number.isFinite(max) ? max : 0,
      min: Number.isFinite(min) ? min : 0
    });
  }

  return peaks;
}

export function aggregateVisibleWaveformPeaks({
  columnCount,
  duration,
  peaks,
  range
}: {
  columnCount: number;
  duration: number;
  peaks: WaveformPeak[];
  range: WaveformRange;
}) {
  const safeColumnCount = Math.max(1, Math.floor(columnCount));
  const safeDuration = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  const visibleDuration = range.end - range.start;

  if (peaks.length === 0 || safeDuration <= 0 || visibleDuration <= 0) {
    return [];
  }

  const startRatio = Math.min(Math.max(0, range.start / safeDuration), 1);
  const endRatio = Math.min(Math.max(startRatio, range.end / safeDuration), 1);
  const startPeak = startRatio * peaks.length;
  const endPeak = Math.max(startPeak + 1, endRatio * peaks.length);
  const peakSpan = endPeak - startPeak;

  return Array.from({ length: safeColumnCount }, (_, columnIndex) => {
    const columnStart = startPeak + (peakSpan * columnIndex) / safeColumnCount;
    const columnEnd =
      startPeak + (peakSpan * (columnIndex + 1)) / safeColumnCount;
    const startIndex = Math.min(
      peaks.length - 1,
      Math.max(0, Math.floor(columnStart))
    );
    const endIndex = Math.min(
      peaks.length,
      Math.max(startIndex + 1, Math.ceil(columnEnd))
    );
    let min = 1;
    let max = -1;

    for (let peakIndex = startIndex; peakIndex < endIndex; peakIndex += 1) {
      const peak = peaks[peakIndex];

      min = Math.min(min, peak.min);
      max = Math.max(max, peak.max);
    }

    return {
      max: Number.isFinite(max) ? max : 0,
      min: Number.isFinite(min) ? min : 0
    };
  });
}

export function nextWaveformZoom(
  currentZoom: number,
  direction: "in" | "out"
): WaveformZoom {
  const currentIndex = waveformZoomLevels.findIndex(
    (zoom) => zoom === currentZoom
  );
  const fallbackIndex = waveformZoomLevels.indexOf(defaultWaveformZoom);
  const safeIndex = currentIndex >= 0 ? currentIndex : fallbackIndex;
  const nextIndex =
    direction === "in"
      ? Math.min(waveformZoomLevels.length - 1, safeIndex + 1)
      : Math.max(0, safeIndex - 1);

  return waveformZoomLevels[nextIndex];
}

export function getWaveformRange(
  duration: number,
  zoom: number,
  viewportStart: number
): WaveformRange {
  const safeDuration = Number.isFinite(duration) ? Math.max(0, duration) : 0;

  if (safeDuration === 0) {
    return { end: 0, start: 0 };
  }

  const safeZoom = Number.isFinite(zoom) ? Math.max(1, zoom) : 1;
  const visibleDuration = safeDuration / safeZoom;
  const maxStart = Math.max(0, safeDuration - visibleDuration);
  const safeStart = Number.isFinite(viewportStart) ? viewportStart : 0;
  const start = Math.min(Math.max(0, safeStart), maxStart);

  return {
    end: Math.min(safeDuration, start + visibleDuration),
    start
  };
}

export function centerWaveformRange(
  time: number,
  duration: number,
  zoom: number
) {
  const safeDuration = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  const safeZoom = Number.isFinite(zoom) ? Math.max(1, zoom) : 1;
  const visibleDuration = safeDuration / safeZoom;

  return getWaveformRange(
    safeDuration,
    safeZoom,
    time - visibleDuration / 2
  ).start;
}

export function keepTimeInWaveformRange(
  time: number,
  duration: number,
  zoom: number,
  viewportStart: number
) {
  const range = getWaveformRange(duration, zoom, viewportStart);
  const visibleDuration = range.end - range.start;

  if (visibleDuration <= 0 || zoom <= 1) {
    return 0;
  }

  const padding = visibleDuration * 0.18;

  if (time < range.start + padding) {
    return getWaveformRange(duration, zoom, time - padding).start;
  }

  if (time > range.end - padding) {
    return getWaveformRange(duration, zoom, time + padding - visibleDuration)
      .start;
  }

  return range.start;
}

export function timeToWaveformPercent(time: number, range: WaveformRange) {
  const visibleDuration = range.end - range.start;

  if (visibleDuration <= 0) {
    return 0;
  }

  return Math.min(
    100,
    Math.max(0, ((time - range.start) / visibleDuration) * 100)
  );
}

export function waveformPercentToTime(
  percent: number,
  range: WaveformRange,
  duration: number
) {
  const safePercent = Math.min(Math.max(0, percent), 1);
  const visibleDuration = range.end - range.start;

  if (visibleDuration <= 0) {
    return 0;
  }

  return Math.min(
    Math.max(0, range.start + visibleDuration * safePercent),
    Math.max(0, duration)
  );
}
