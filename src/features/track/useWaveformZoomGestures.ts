import { type RefObject, useEffect, useRef } from "react";

const wheelZoomSensitivity = 0.01;
const minWheelScale = 0.8;
const maxWheelScale = 1.25;

type GestureEventWithScale = Event & {
  scale?: unknown;
};

function getGestureScale(event: Event) {
  const scale = (event as GestureEventWithScale).scale;

  return typeof scale === "number" && Number.isFinite(scale) ? scale : 1;
}

function normalizeWheelDelta(event: WheelEvent, target: HTMLElement) {
  if (event.deltaMode === 1) {
    return event.deltaY * 16;
  }

  if (event.deltaMode === 2) {
    return event.deltaY * Math.max(1, target.clientHeight);
  }

  return event.deltaY;
}

export function useWaveformZoomGestures({
  onScale,
  targetRef
}: {
  onScale: (scale: number) => void;
  targetRef: RefObject<HTMLElement | null>;
}) {
  const onScaleRef = useRef(onScale);

  useEffect(() => {
    onScaleRef.current = onScale;
  }, [onScale]);

  useEffect(() => {
    const target = targetRef.current;

    if (!target) {
      return undefined;
    }

    let safariGestureScale = 1;
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) {
        return;
      }

      event.preventDefault();

      const delta = normalizeWheelDelta(event, target);

      if (!Number.isFinite(delta) || delta === 0) {
        return;
      }

      const scale = Math.exp(-delta * wheelZoomSensitivity);

      onScaleRef.current(Math.min(maxWheelScale, Math.max(minWheelScale, scale)));
    };
    const handleGestureStart = (event: Event) => {
      event.preventDefault();
      safariGestureScale = getGestureScale(event);
    };
    const handleGestureChange = (event: Event) => {
      event.preventDefault();

      const nextScale = getGestureScale(event);
      const relativeScale = nextScale / safariGestureScale;

      if (
        Number.isFinite(relativeScale) &&
        relativeScale > 0 &&
        relativeScale !== 1
      ) {
        onScaleRef.current(relativeScale);
      }

      safariGestureScale = nextScale;
    };
    const handleGestureEnd = (event: Event) => {
      event.preventDefault();
      safariGestureScale = 1;
    };

    target.addEventListener("wheel", handleWheel, { passive: false });
    target.addEventListener("gesturestart", handleGestureStart, {
      passive: false
    });
    target.addEventListener("gesturechange", handleGestureChange, {
      passive: false
    });
    target.addEventListener("gestureend", handleGestureEnd, { passive: false });

    return () => {
      target.removeEventListener("wheel", handleWheel);
      target.removeEventListener("gesturestart", handleGestureStart);
      target.removeEventListener("gesturechange", handleGestureChange);
      target.removeEventListener("gestureend", handleGestureEnd);
    };
  }, [targetRef]);
}
