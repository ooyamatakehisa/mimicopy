import { useEffect, useRef, type RefObject } from "react";

const tapMovementLimit = 10;
const tapDurationLimit = 300;

type PendingTap = {
  pointerId: number;
  startedAt: number;
  x: number;
  y: number;
};

export function useWaveformSeekGesture({
  onSeek,
  targetRef
}: {
  onSeek: (clientX: number) => void;
  targetRef: RefObject<HTMLElement | null>;
}) {
  const onSeekRef = useRef(onSeek);

  useEffect(() => {
    onSeekRef.current = onSeek;
  }, [onSeek]);

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;

    let pendingTap: PendingTap | null = null;
    const cancelTap = () => { pendingTap = null; };
    const isWithinTarget = (event: PointerEvent) =>
      event.target instanceof Node && target.contains(event.target);
    const hasMoved = (event: PointerEvent, tap: PendingTap) =>
      Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > tapMovementLimit;

    const handlePointerDown = (event: PointerEvent) => {
      // Listen in capture phase so a second finger on a marker also cancels seeking.
      cancelTap();
      if (!event.isPrimary || event.button !== 0 || !isWithinTarget(event) ||
        (event.target instanceof Element && event.target.closest("button"))) return;

      pendingTap = {
        pointerId: event.pointerId,
        startedAt: performance.now(),
        x: event.clientX,
        y: event.clientY
      };
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (pendingTap?.pointerId === event.pointerId && hasMoved(event, pendingTap)) {
        // Once movement begins, returning to the starting point is still a drag.
        cancelTap();
      }
    };
    const handlePointerUp = (event: PointerEvent) => {
      const tap = pendingTap;
      cancelTap();
      if (!tap || tap.pointerId !== event.pointerId || !isWithinTarget(event) ||
        hasMoved(event, tap) || performance.now() - tap.startedAt > tapDurationLimit) return;

      onSeekRef.current(event.clientX);
    };

    // Never prevent default or capture pointers: vertical scrolling stays native.
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("pointermove", handlePointerMove, true);
    window.addEventListener("pointerup", handlePointerUp, true);
    window.addEventListener("pointercancel", cancelTap, true);
    window.addEventListener("blur", cancelTap);
    target.addEventListener("gesturestart", cancelTap);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerup", handlePointerUp, true);
      window.removeEventListener("pointercancel", cancelTap, true);
      window.removeEventListener("blur", cancelTap);
      target.removeEventListener("gesturestart", cancelTap);
    };
  }, [targetRef]);
}
