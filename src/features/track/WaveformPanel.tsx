import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StatusBadge } from "../../components/ui/StatusBadge";
import type { BeatGrid } from "../../lib/beats";
import { cn } from "../../lib/cn";
import type { LoadState } from "../../lib/loadState";
import type { Marker } from "../../lib/markers";
import { clampTime, formatTime } from "../../lib/playback";
import {
  aggregateVisibleWaveformPeaks,
  timeToWaveformPercent,
  waveformPercentToTime,
  type WaveformPeak,
  type WaveformRange
} from "../../lib/waveform";
import type { DynamicStyle } from "./types";
import { useWaveformZoomGestures } from "./useWaveformZoomGestures";

type WaveformPanelProps = {
  beatGrid: BeatGrid | null;
  currentTime: number;
  duration: number;
  loadState: LoadState;
  message: string | null;
  moveMarkerTo: (markerId: string, time: number) => void;
  peaks: WaveformPeak[];
  seekTo: (time: number) => void;
  selectMarker: (markerId: string | null) => void;
  selectedMarkerId: string | null;
  scaleWaveformZoomContinuously: (scale: number) => void;
  sortedMarkers: Marker[];
  waveformRange: WaveformRange;
};

function drawBeatGridLines({
  beatGrid,
  context,
  height,
  waveformRange,
  width
}: {
  beatGrid: BeatGrid | null;
  context: CanvasRenderingContext2D;
  height: number;
  waveformRange: WaveformRange;
  width: number;
}) {
  if (!beatGrid || beatGrid.beats.length === 0) {
    return;
  }

  let drawnBeatCount = 0;

  for (const beat of beatGrid.beats) {
    if (beat.time < waveformRange.start || beat.time > waveformRange.end) {
      continue;
    }

    if (drawnBeatCount >= 2000) {
      return;
    }

    const x = Math.round(
      (timeToWaveformPercent(beat.time, waveformRange) / 100) * width
    );

    context.fillStyle = beat.isDownbeat
      ? "rgba(255, 138, 101, 0.64)"
      : "rgba(244, 247, 245, 0.2)";
    context.fillRect(x, 0, beat.isDownbeat ? 2 : 1, height);
    drawnBeatCount += 1;
  }
}

function getWaveformInteractionBounds(
  waveform: HTMLElement | null,
  canvas: HTMLCanvasElement | null
) {
  const canvasBounds = canvas?.getBoundingClientRect();

  if (canvasBounds && canvasBounds.width > 0) {
    return canvasBounds;
  }

  const waveformBounds = waveform?.getBoundingClientRect();

  return waveformBounds && waveformBounds.width > 0 ? waveformBounds : null;
}

export function WaveformPanel({
  beatGrid,
  currentTime,
  duration,
  loadState,
  message,
  moveMarkerTo,
  peaks,
  seekTo,
  selectMarker,
  selectedMarkerId,
  scaleWaveformZoomContinuously,
  sortedMarkers,
  waveformRange
}: WaveformPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const waveformRef = useRef<HTMLDivElement>(null);
  const draggingMarkerIdRef = useRef<string | null>(null);
  const [draggingMarkerId, setDraggingMarkerId] = useState<string | null>(null);
  const [waveformSize, setWaveformSize] = useState({ height: 0, width: 0 });

  useWaveformZoomGestures({
    onScale: scaleWaveformZoomContinuously,
    targetRef: waveformRef
  });

  const visibleMarkers = useMemo(
    () =>
      sortedMarkers.filter(
        (marker) =>
          marker.time >= waveformRange.start && marker.time <= waveformRange.end
      ),
    [sortedMarkers, waveformRange.end, waveformRange.start]
  );
  const playheadPercent = timeToWaveformPercent(currentTime, waveformRange);
  const playheadStyle: DynamicStyle = {
    "--marker-left": "0%",
    "--playhead-left": `${playheadPercent}%`
  };

  const handleWaveformPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!duration) {
        return;
      }

      const bounds = getWaveformInteractionBounds(
        event.currentTarget,
        canvasRef.current
      );

      if (!bounds) {
        return;
      }

      const ratio = clampTime((event.clientX - bounds.left) / bounds.width, 1);

      seekTo(waveformPercentToTime(ratio, waveformRange, duration));
    },
    [duration, seekTo, waveformRange]
  );

  const moveMarkerFromPointer = useCallback(
    (markerId: string, clientX: number) => {
      const waveform = waveformRef.current;

      if (!waveform || !duration) {
        return;
      }

      const bounds = getWaveformInteractionBounds(waveform, canvasRef.current);

      if (!bounds) {
        return;
      }

      const ratio = clampTime((clientX - bounds.left) / bounds.width, 1);

      moveMarkerTo(
        markerId,
        waveformPercentToTime(ratio, waveformRange, duration)
      );
    },
    [duration, moveMarkerTo, waveformRange]
  );

  const startDraggingMarker = useCallback((markerId: string) => {
    draggingMarkerIdRef.current = markerId;
    setDraggingMarkerId(markerId);
  }, []);

  const stopDraggingMarker = useCallback(() => {
    draggingMarkerIdRef.current = null;
    setDraggingMarkerId(null);
  }, []);

  useEffect(() => {
    const moveDraggedMarker = (clientX: number) => {
      const markerId = draggingMarkerIdRef.current;

      if (markerId) {
        moveMarkerFromPointer(markerId, clientX);
      }
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (!draggingMarkerIdRef.current) {
        return;
      }

      event.preventDefault();
      moveDraggedMarker(event.clientX);
    };
    const handleMouseMove = (event: MouseEvent) => {
      if (!draggingMarkerIdRef.current) {
        return;
      }

      event.preventDefault();
      moveDraggedMarker(event.clientX);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopDraggingMarker);
    window.addEventListener("pointercancel", stopDraggingMarker);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", stopDraggingMarker);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopDraggingMarker);
      window.removeEventListener("pointercancel", stopDraggingMarker);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopDraggingMarker);
    };
  }, [moveMarkerFromPointer, stopDraggingMarker]);

  useEffect(() => {
    const waveform = waveformRef.current;

    if (!waveform) {
      return undefined;
    }

    const observer = new ResizeObserver(([entry]) => {
      const { height, width } = entry.contentRect;
      setWaveformSize({ height, width });
    });

    observer.observe(waveform);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");

    if (!context) {
      return;
    }

    const cssWidth = Math.max(1, Math.floor(waveformSize.width));
    const cssHeight = Math.max(1, Math.floor(waveformSize.height));
    const pixelRatio = window.devicePixelRatio || 1;
    const width = Math.floor(cssWidth * pixelRatio);
    const height = Math.floor(cssHeight * pixelRatio);

    canvas.width = width;
    canvas.height = height;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, cssWidth, cssHeight);

    const gradient = context.createLinearGradient(0, 0, cssWidth, cssHeight);
    gradient.addColorStop(0, "#00a99d");
    gradient.addColorStop(0.5, "#3a86ff");
    gradient.addColorStop(1, "#ff6b4a");

    context.fillStyle = "rgba(255, 255, 255, 0.035)";
    context.fillRect(0, 0, cssWidth, cssHeight);

    if (peaks.length === 0) {
      context.fillStyle = "rgba(244, 247, 245, 0.18)";
      context.fillRect(0, cssHeight / 2 - 1, cssWidth, 2);
    } else {
      const visiblePeaks = aggregateVisibleWaveformPeaks({
        columnCount: cssWidth,
        duration,
        peaks,
        range: waveformRange
      });

      if (visiblePeaks.length === 0) {
        context.fillStyle = "rgba(244, 247, 245, 0.18)";
        context.fillRect(0, cssHeight / 2 - 1, cssWidth, 2);
      } else {
        const centerY = cssHeight / 2;
        const barWidth = cssWidth / visiblePeaks.length;

        context.fillStyle = gradient;

        for (let index = 0; index < visiblePeaks.length; index += 1) {
          const peak = visiblePeaks[index];
          const min = Math.min(0, peak.min);
          const max = Math.max(0, peak.max);
          const x = index * barWidth;
          const y = centerY - max * centerY;
          const barHeight = Math.max(1, (max - min) * centerY);

          context.fillRect(x, y, Math.max(1, barWidth), barHeight);
        }
      }
    }

    drawBeatGridLines({
      beatGrid,
      context,
      height: cssHeight,
      waveformRange,
      width: cssWidth
    });
  }, [beatGrid, duration, peaks, waveformRange, waveformSize]);

  return (
    <section
      className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-[2rem] border border-white/8 bg-white/[0.04]"
      aria-label="Waveform"
    >
      <div
        className={cn(
          "mx-3 mt-3 grid min-h-14 items-center gap-3 rounded-full border border-white/8 bg-black/18 px-3 text-sm text-muted max-sm:grid-cols-1 max-sm:items-start max-sm:rounded-3xl max-sm:px-3 max-sm:py-3",
          message
            ? "grid-cols-[auto_minmax(0,1fr)_auto]"
            : "grid-cols-[auto_minmax(0,1fr)]"
        )}
      >
        <StatusBadge state={loadState}>{loadState}</StatusBadge>
        {message ? <span className="min-w-0 truncate">{message}</span> : null}
        <span className="justify-self-end whitespace-nowrap font-bold tabular-nums text-ink max-sm:justify-self-start">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>

      <div
        ref={waveformRef}
        className="waveformSurface relative m-3 h-[clamp(320px,48vh,580px)] min-h-0 cursor-crosshair overflow-hidden rounded-[1.75rem] border border-white/8 bg-[radial-gradient(circle_at_15%_10%,rgba(67,224,202,0.16),transparent_24%),radial-gradient(circle_at_85%_90%,rgba(255,138,101,0.12),transparent_25%),linear-gradient(rgba(244,247,245,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(244,247,245,0.045)_1px,transparent_1px),linear-gradient(180deg,#111816_0%,#070908_100%)] bg-[length:auto,auto,100%_25%,84px_100%,auto] outline-none after:pointer-events-none after:absolute after:inset-0 after:rounded-[1.75rem] after:bg-[linear-gradient(180deg,rgba(255,255,255,0.05),transparent_34%,rgba(0,0,0,0.18))] focus-visible:shadow-[inset_0_0_0_2px_rgba(122,167,255,0.72)] max-sm:h-[clamp(240px,42vh,380px)]"
        role="slider"
        aria-label="再生位置"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, Math.floor(duration))}
        aria-valuenow={Math.floor(currentTime)}
        title="クリックでシーク・ピンチで波形をズーム"
        tabIndex={0}
        onPointerDown={handleWaveformPointerDown}
      >
        <canvas ref={canvasRef} className="block size-full" />
        {visibleMarkers.map((marker) => (
          <WaveformMarker
            key={marker.id}
            draggingMarkerId={draggingMarkerId}
            marker={marker}
            moveMarkerFromPointer={moveMarkerFromPointer}
            selectMarker={selectMarker}
            selectedMarkerId={selectedMarkerId}
            startDraggingMarker={startDraggingMarker}
            stopDraggingMarker={stopDraggingMarker}
            waveformRange={waveformRange}
            seekTo={seekTo}
            draggingMarkerIdRef={draggingMarkerIdRef}
          />
        ))}
        <div
          className="pointer-events-none absolute inset-y-0 left-[var(--playhead-left)] z-30 w-0.5 bg-teal shadow-[0_0_0_1px_rgba(7,16,15,0.78),0_0_24px_rgba(67,224,202,0.48)]"
          style={playheadStyle}
        />
      </div>
    </section>
  );
}

function WaveformMarker({
  draggingMarkerId,
  draggingMarkerIdRef,
  marker,
  moveMarkerFromPointer,
  seekTo,
  selectMarker,
  selectedMarkerId,
  startDraggingMarker,
  stopDraggingMarker,
  waveformRange
}: {
  draggingMarkerId: string | null;
  draggingMarkerIdRef: React.MutableRefObject<string | null>;
  marker: Marker;
  moveMarkerFromPointer: (markerId: string, clientX: number) => void;
  seekTo: (time: number) => void;
  selectMarker: (markerId: string | null) => void;
  selectedMarkerId: string | null;
  startDraggingMarker: (markerId: string) => void;
  stopDraggingMarker: () => void;
  waveformRange: WaveformRange;
}) {
  const style: DynamicStyle = {
    "--marker-left": `${timeToWaveformPercent(marker.time, waveformRange)}%`,
    "--playhead-left": "0%"
  };

  return (
    <button
      className={cn(
        "markerLine absolute inset-y-0 left-[var(--marker-left)] z-20 w-3 cursor-ew-resize touch-none border-0 border-l-2 border-coral bg-transparent p-0 before:absolute before:left-[-7px] before:top-4 before:size-3 before:rotate-45 before:rounded-[3px] before:border-2 before:border-[#07100f] before:bg-coral before:shadow-[0_10px_24px_rgba(255,138,101,0.28)] hover:border-blue hover:before:bg-blue focus-visible:border-blue focus-visible:outline-none focus-visible:before:bg-blue",
        marker.id === selectedMarkerId && "border-coral before:bg-coral",
        marker.id === draggingMarkerId && "border-ink before:bg-ink"
      )}
      draggable
      style={style}
      type="button"
      title={`${marker.label} ${formatTime(marker.time)}`}
      onDragStart={(event) => {
        event.stopPropagation();
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", marker.id);
        selectMarker(marker.id);
        startDraggingMarker(marker.id);
        moveMarkerFromPointer(marker.id, event.clientX);
      }}
      onDrag={(event) => {
        if (draggingMarkerIdRef.current !== marker.id || event.clientX <= 0) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        moveMarkerFromPointer(marker.id, event.clientX);
      }}
      onDragEnd={(event) => {
        event.stopPropagation();

        if (event.clientX > 0) {
          moveMarkerFromPointer(marker.id, event.clientX);
        }

        stopDraggingMarker();
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        selectMarker(marker.id);
        startDraggingMarker(marker.id);
        event.currentTarget.setPointerCapture(event.pointerId);
        moveMarkerFromPointer(marker.id, event.clientX);
      }}
      onPointerMove={(event) => {
        if (draggingMarkerIdRef.current !== marker.id) {
          return;
        }

        event.stopPropagation();
        moveMarkerFromPointer(marker.id, event.clientX);
      }}
      onPointerUp={(event) => {
        event.stopPropagation();
        stopDraggingMarker();

        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={(event) => {
        stopDraggingMarker();

        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onClick={(event) => {
        event.stopPropagation();
        selectMarker(marker.id);
        seekTo(marker.time);
      }}
    />
  );
}
