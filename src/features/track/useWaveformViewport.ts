import { useCallback, useEffect, useMemo, useState } from "react";
import {
  centerWaveformRange, defaultWaveformZoom, getWaveformRange,
  keepTimeInWaveformRange, nextWaveformZoom, panWaveformRange,
  scaleWaveformZoom, type WaveformZoomDirection
} from "../../lib/waveform";

export function useWaveformViewport({ currentTime, duration }: {
  currentTime: number;
  duration: number;
}) {
  const [viewport, setViewport] = useState({
    zoom: Number(defaultWaveformZoom), start: 0, following: true
  });
  const waveformRange = useMemo(
    () => getWaveformRange(duration, viewport.zoom, viewport.start),
    [duration, viewport.start, viewport.zoom]
  );
  const zoomTo = useCallback((getZoom: (zoom: number) => number) => {
    setViewport((current) => {
      const zoom = getZoom(current.zoom);
      const range = getWaveformRange(duration, current.zoom, current.start);
      const anchor = current.following ? currentTime : (range.start + range.end) / 2;
      return { zoom, start: centerWaveformRange(anchor, duration, zoom),
        following: zoom === 1 || current.following };
    });
  }, [currentTime, duration]);
  const changeWaveformZoom = useCallback((direction: WaveformZoomDirection) => {
    zoomTo((zoom) => nextWaveformZoom(zoom, direction));
  }, [zoomTo]);
  const scaleWaveformZoomContinuously = useCallback((scale: number) => {
    zoomTo((zoom) => scaleWaveformZoom(zoom, scale));
  }, [zoomTo]);
  const panWaveform = useCallback((fraction: number) => {
    setViewport((current) => current.zoom <= 1 || !Number.isFinite(fraction) || fraction === 0
      ? current
      : { ...current, following: false,
          start: panWaveformRange(duration, current.zoom, current.start, fraction) });
  }, [duration]);
  const followPlayback = useCallback(() => {
    setViewport((current) => ({ ...current, following: true,
      start: centerWaveformRange(currentTime, duration, current.zoom) }));
  }, [currentTime, duration]);

  useEffect(() => {
    setViewport((current) => {
      const start = current.following
        ? keepTimeInWaveformRange(currentTime, duration, current.zoom, current.start)
        : getWaveformRange(duration, current.zoom, current.start).start;
      return start === current.start ? current : { ...current, start };
    });
  }, [currentTime, duration]);

  return useMemo(() => ({ changeWaveformZoom, scaleWaveformZoomContinuously,
    panWaveform, followPlayback, isFollowingPlayback: viewport.following,
    waveformRange, waveformZoom: viewport.zoom }),
  [changeWaveformZoom, scaleWaveformZoomContinuously, panWaveform, followPlayback,
    viewport.following, waveformRange, viewport.zoom]);
}

export type WaveformViewportState = ReturnType<typeof useWaveformViewport>;
