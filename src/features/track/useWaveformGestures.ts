import { useEffect, useRef, type RefObject } from "react";

const movementThreshold = 10;
const tapDurationLimit = 300;
type PointerGesture = {
  id: number; x: number; y: number; lastX: number; startedAt: number;
  axis: "pending" | "horizontal";
};
type GestureOptions = {
  canPan: boolean;
  onPan: (fraction: number) => void;
  onScale: (scale: number) => void;
  onSeek: (clientX: number) => void;
};

export function useWaveformGestures({ targetRef, ...options }: GestureOptions & {
  targetRef: RefObject<HTMLElement | null>;
}) {
  const optionsRef = useRef(options);
  useEffect(() => { optionsRef.current = options; }, [options]);

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    let pointer: PointerGesture | null = null;
    let pinchDistance: number | null = null;
    let safariScale = 1;
    const cancelPointer = () => { pointer = null; };
    const contains = (event: PointerEvent) =>
      event.target instanceof Node && target.contains(event.target);
    const pointerDown = (event: PointerEvent) => {
      cancelPointer();
      if (!event.isPrimary || event.button !== 0 || !contains(event) ||
        (event.target instanceof Element && event.target.closest("button"))) return;
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY,
        lastX: event.clientX, startedAt: performance.now(), axis: "pending" };
    };
    const pointerMove = (event: PointerEvent) => {
      const gesture = pointer;
      if (!gesture || gesture.id !== event.pointerId) return;
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      if (gesture.axis === "pending") {
        if (Math.hypot(dx, dy) <= movementThreshold) return;
        if (Math.abs(dx) <= Math.abs(dy) || !optionsRef.current.canPan) {
          cancelPointer();
          return;
        }
        gesture.axis = "horizontal";
      }
      const width = target.clientWidth;
      if (width > 0) optionsRef.current.onPan((gesture.lastX - event.clientX) / width);
      gesture.lastX = event.clientX;
    };
    const pointerUp = (event: PointerEvent) => {
      const gesture = pointer;
      cancelPointer();
      if (!gesture || gesture.id !== event.pointerId || gesture.axis !== "pending" ||
        !contains(event) || performance.now() - gesture.startedAt > tapDurationLimit ||
        Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > movementThreshold) return;
      optionsRef.current.onSeek(event.clientX);
    };
    const distance = (touches: TouchList) => Math.hypot(
      touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    const touchStart = (event: TouchEvent) => {
      if (event.touches.length >= 2) {
        cancelPointer();
        pinchDistance = distance(event.touches);
      }
    };
    const touchMove = (event: TouchEvent) => {
      if (event.touches.length < 2) {
        if (pointer?.axis === "horizontal") event.preventDefault();
        return;
      }
      cancelPointer();
      event.preventDefault();
      const next = distance(event.touches);
      if (pinchDistance && next > 0) optionsRef.current.onScale(next / pinchDistance);
      pinchDistance = next;
    };
    const touchEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) pinchDistance = null;
    };
    const getScale = (event: Event) => {
      const value = (event as Event & { scale?: unknown }).scale;
      return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 1;
    };
    const gestureStart = (event: Event) => {
      cancelPointer();
      event.preventDefault();
      safariScale = getScale(event);
    };
    const gestureChange = (event: Event) => {
      event.preventDefault();
      const next = getScale(event);
      // Touch events own physical pinches. Safari gesture events also cover trackpads.
      if (pinchDistance === null) optionsRef.current.onScale(next / safariScale);
      safariScale = next;
    };
    const gestureEnd = (event: Event) => { event.preventDefault(); safariScale = 1; };
    const wheel = (event: WheelEvent) => {
      const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? target.clientHeight : 1;
      if (event.ctrlKey) {
        event.preventDefault();
        const scale = Math.exp(-event.deltaY * units * 0.01);
        if (Number.isFinite(scale)) optionsRef.current.onScale(Math.min(1.25, Math.max(0.8, scale)));
      } else if (optionsRef.current.canPan && (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY))) {
        event.preventDefault();
        optionsRef.current.onPan((event.deltaX || event.deltaY) * units / Math.max(1, target.clientWidth));
      }
    };

    // pan-y preserves page scrolling while one-finger horizontal drags stay in the waveform.
    window.addEventListener("pointerdown", pointerDown, true);
    window.addEventListener("pointermove", pointerMove, true);
    window.addEventListener("pointerup", pointerUp, true);
    window.addEventListener("pointercancel", cancelPointer, true);
    window.addEventListener("blur", cancelPointer);
    target.addEventListener("touchstart", touchStart, { passive: true });
    target.addEventListener("touchmove", touchMove, { passive: false });
    target.addEventListener("touchend", touchEnd);
    target.addEventListener("touchcancel", touchEnd);
    target.addEventListener("gesturestart", gestureStart, { passive: false });
    target.addEventListener("gesturechange", gestureChange, { passive: false });
    target.addEventListener("gestureend", gestureEnd, { passive: false });
    target.addEventListener("wheel", wheel, { passive: false });
    return () => {
      window.removeEventListener("pointerdown", pointerDown, true);
      window.removeEventListener("pointermove", pointerMove, true);
      window.removeEventListener("pointerup", pointerUp, true);
      window.removeEventListener("pointercancel", cancelPointer, true);
      window.removeEventListener("blur", cancelPointer);
      target.removeEventListener("touchstart", touchStart);
      target.removeEventListener("touchmove", touchMove);
      target.removeEventListener("touchend", touchEnd);
      target.removeEventListener("touchcancel", touchEnd);
      target.removeEventListener("gesturestart", gestureStart);
      target.removeEventListener("gesturechange", gestureChange);
      target.removeEventListener("gestureend", gestureEnd);
      target.removeEventListener("wheel", wheel);
    };
  }, [targetRef]);
}
