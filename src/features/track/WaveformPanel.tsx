import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BeatGrid } from "../../lib/beats";
import { cn } from "../../lib/cn";
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
import { ChevronLeft, ChevronRight, LocateFixed } from "lucide-react";
import { IconButton } from "../../components/ui/Button";
import { useWaveformGestures } from "./useWaveformGestures";

type WaveformPanelProps = {
  beatGrid: BeatGrid | null;
  currentTime: number;
  duration: number;
  message: string | null;
  moveMarkerTo: (markerId: string, time: number) => void;
  peaks: WaveformPeak[];
  seekTo: (time: number) => void;
  selectMarker: (markerId: string | null) => void;
  selectedMarkerId: string | null;
  scaleWaveformZoomContinuously: (scale: number) => void;
  sortedMarkers: Marker[];
  waveformRange: WaveformRange;
  panWaveform: (fraction: number) => void;
  followPlayback: () => void;
  isFollowingPlayback: boolean;
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
  message,
  moveMarkerTo,
  peaks,
  seekTo,
  selectMarker,
  selectedMarkerId,
  scaleWaveformZoomContinuously,
  sortedMarkers,
  waveformRange,
  panWaveform,
  followPlayback,
  isFollowingPlayback
}: WaveformPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const waveformRef = useRef<HTMLDivElement>(null);
  const draggingMarkerIdRef = useRef<string | null>(null);
  const [draggingMarkerId, setDraggingMarkerId] = useState<string | null>(null);
  const [waveformSize, setWaveformSize] = useState({ height: 0, width: 0 });

  const canPan = waveformRange.end - waveformRange.start < duration;

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

  const seekFromPointer = useCallback(
    (clientX: number) => {
      if (!duration) {
        return;
      }

      const bounds = getWaveformInteractionBounds(
        waveformRef.current,
        canvasRef.current
      );

      if (!bounds) {
        return;
      }

      const ratio = clampTime((clientX - bounds.left) / bounds.width, 1);

      seekTo(waveformPercentToTime(ratio, waveformRange, duration));
    },
    [duration, seekTo, waveformRange]
  );

  useWaveformGestures({ onSeek: seekFromPointer, onPan: panWaveform,
    onScale: scaleWaveformZoomContinuously, canPan, targetRef: waveformRef });

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
      className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/8 bg-white/[0.04]"
      aria-label="Waveform"
    >
      {message ? <p role="alert" className="mx-4 mt-3 text-sm text-danger">{message}</p> : null}

      <div
        ref={waveformRef}
        className="waveformSurface relative m-2 touch-pan-y select-none h-[clamp(120px,22svh,180px)] min-h-0 shrink-0 cursor-crosshair overflow-hidden rounded-xl border border-white/8 bg-[radial-gradient(circle_at_15%_10%,rgba(67,224,202,0.16),transparent_24%),radial-gradient(circle_at_85%_90%,rgba(255,138,101,0.12),transparent_25%),linear-gradient(rgba(244,247,245,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(244,247,245,0.045)_1px,transparent_1px),linear-gradient(180deg,#111816_0%,#070908_100%)] bg-[length:auto,auto,100%_25%,84px_100%,auto] outline-none after:pointer-events-none after:absolute after:inset-0 after:rounded-xl after:bg-[linear-gradient(180deg,rgba(255,255,255,0.05),transparent_34%,rgba(0,0,0,0.18))] focus-visible:shadow-[inset_0_0_0_2px_rgba(122,167,255,0.72)] sm:h-[clamp(160px,28svh,260px)] lg:h-[clamp(320px,48vh,580px)]"
        role="slider"
        aria-label="再生位置"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, Math.floor(duration))}
        aria-valuenow={Math.floor(currentTime)}
        title="タップでシーク・横ドラッグで移動・ピンチでズーム"
        aria-valuetext={formatTime(currentTime)}
        onKeyDown={(event) => {
          if (canPan && event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
            event.preventDefault();
            event.stopPropagation();
            panWaveform(event.key === "ArrowLeft" ? -0.5 : 0.5);
          }
        }}
        tabIndex={0}
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
        {currentTime >= waveformRange.start && currentTime <= waveformRange.end ? <div
          className="pointer-events-none absolute inset-y-0 left-[var(--playhead-left)] z-30 w-0.5 bg-teal shadow-[0_0_0_1px_rgba(7,16,15,0.78),0_0_24px_rgba(67,224,202,0.48)]"
          style={playheadStyle}
        /> : null}
      </div>
      {canPan ? (
        <div className="mx-2 mb-1 flex min-h-11 items-center justify-between gap-1">
          <IconButton className="size-11" title="波形を左へ" disabled={waveformRange.start <= 0} onClick={() => panWaveform(-0.5)}>
            <ChevronLeft size={18} />
          </IconButton>
          <output aria-label="波形の表示範囲" aria-live="off" className="min-w-0 text-xs tabular-nums text-muted">
            {formatTime(waveformRange.start)} – {formatTime(waveformRange.end)}
          </output>
          <IconButton className="size-11" title="再生位置を追従" aria-pressed={isFollowingPlayback}
            variant={isFollowingPlayback ? "accent" : "secondary"} onClick={followPlayback}>
            <LocateFixed size={18} />
          </IconButton>
          <IconButton className="size-11" title="波形を右へ" disabled={waveformRange.end >= duration} onClick={() => panWaveform(0.5)}>
            <ChevronRight size={18} />
          </IconButton>
        </div>
      ) : null}
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
