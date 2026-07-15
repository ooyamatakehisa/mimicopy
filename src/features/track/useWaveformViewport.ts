import { useCallback, useEffect, useMemo, useState } from "react";
import {
  centerWaveformRange,
  defaultWaveformZoom,
  getWaveformRange,
  keepTimeInWaveformRange,
  nextWaveformZoom,
  type WaveformZoom
} from "../../lib/waveform";

export function useWaveformViewport({
  currentTime,
  duration
}: {
  currentTime: number;
  duration: number;
}) {
  const [waveformZoom, setWaveformZoom] =
    useState<WaveformZoom>(defaultWaveformZoom);
  const [waveformStart, setWaveformStart] = useState(0);
  const waveformRange = useMemo(
    () => getWaveformRange(duration, waveformZoom, waveformStart),
    [duration, waveformStart, waveformZoom]
  );

  const changeWaveformZoom = useCallback(
    (direction: "in" | "out") => {
      setWaveformZoom((currentZoom) => {
        const nextZoom = nextWaveformZoom(currentZoom, direction);

        setWaveformStart(centerWaveformRange(currentTime, duration, nextZoom));

        return nextZoom;
      });
    },
    [currentTime, duration]
  );

  useEffect(() => {
    setWaveformStart((currentStart) =>
      keepTimeInWaveformRange(currentTime, duration, waveformZoom, currentStart)
    );
  }, [currentTime, duration, waveformZoom]);

  return useMemo(
    () => ({
      changeWaveformZoom,
      waveformRange,
      waveformZoom
    }),
    [changeWaveformZoom, waveformRange, waveformZoom]
  );
}

export type WaveformViewportState = ReturnType<typeof useWaveformViewport>;
