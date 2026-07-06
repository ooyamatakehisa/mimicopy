export type WaveformPeak = {
  min: number;
  max: number;
};

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
