import { useCallback, useEffect, useMemo, useState } from "react";
import {
  centerWaveformRange,
  defaultWaveformZoom,
  getWaveformRange,
  keepTimeInWaveformRange,
  nextWaveformZoom,
  scaleWaveformZoom,
  type WaveformZoomDirection
} from "../../lib/waveform";

export function useWaveformViewport({
  currentTime,
  duration
}: {
  currentTime: number;
  duration: number;
}) {
  const [waveformZoom, setWaveformZoom] = useState<number>(defaultWaveformZoom);
  const [waveformStart, setWaveformStart] = useState(0);
  const waveformRange = useMemo(
    () => getWaveformRange(duration, waveformZoom, waveformStart),
    [duration, waveformStart, waveformZoom]
  );

  const changeWaveformZoom = useCallback(
    (direction: WaveformZoomDirection) => {
      setWaveformZoom((currentZoom) => {
        const nextZoom = nextWaveformZoom(currentZoom, direction);

        setWaveformStart(centerWaveformRange(currentTime, duration, nextZoom));

        return nextZoom;
      });
    },
    [currentTime, duration]
  );

  const scaleWaveformZoomContinuously = useCallback(
    (scale: number) => {
      setWaveformZoom((currentZoom) => {
        const nextZoom = scaleWaveformZoom(currentZoom, scale);

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
      scaleWaveformZoomContinuously,
      waveformRange,
      waveformZoom
    }),
    [
      changeWaveformZoom,
      scaleWaveformZoomContinuously,
      waveformRange,
      waveformZoom
    ]
  );
}

export type WaveformViewportState = ReturnType<typeof useWaveformViewport>;
