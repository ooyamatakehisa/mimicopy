import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import {
  centerWaveformRange, getWaveformRange,
  keepTimeInWaveformRange, nextWaveformZoom, panWaveformRange,
  scaleWaveformZoom, type WaveformZoomDirection
} from "../../lib/waveform";

export function useWaveformViewport({ currentTime, duration, waveformZoom, setWaveformZoom }: {
  currentTime: number;
  duration: number;
  waveformZoom: number;
  setWaveformZoom: Dispatch<SetStateAction<number>>;
}) {
  const [viewport, setViewport] = useState({
    zoom: waveformZoom, start: 0, following: true
  });
  if (viewport.zoom !== waveformZoom) {
    // Recenter using the previous visible range when the zoom changes.
    const range = getWaveformRange(duration, viewport.zoom, viewport.start);
    const anchor = viewport.following ? currentTime : (range.start + range.end) / 2;
    setViewport({
      zoom: waveformZoom,
      start: centerWaveformRange(anchor, duration, waveformZoom),
      following: waveformZoom === 1 || viewport.following
    });
  }
  const waveformRange = useMemo(
    () => getWaveformRange(duration, viewport.zoom, viewport.start),
    [duration, viewport.start, viewport.zoom]
  );
  const changeWaveformZoom = useCallback((direction: WaveformZoomDirection) => {
    setWaveformZoom((zoom) => nextWaveformZoom(zoom, direction));
  }, [setWaveformZoom]);
  const scaleWaveformZoomContinuously = useCallback((scale: number) => {
    setWaveformZoom((zoom) => scaleWaveformZoom(zoom, scale));
  }, [setWaveformZoom]);
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
