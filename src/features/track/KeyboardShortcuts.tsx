import { useCallback, useEffect } from "react";
import { findReturnMarker } from "../../lib/markers";
import { getShortcutCommand } from "../../lib/playback";
import type { MarkersState } from "./useMarkersState";
import type { PlaybackState } from "./usePlaybackState";

type KeyboardShortcutsProps = {
  markers: MarkersState;
  playback: PlaybackState;
};

function isTextEntryTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const input = target.closest("input");
  if (input && !["button", "submit", "reset", "checkbox", "radio", "range"].includes(input.type)) return true;
  return Boolean(target.closest("textarea, select, [contenteditable]:not([contenteditable='false'])"));
}

function usesSliderNavigation(event: KeyboardEvent) {
  return event.shiftKey &&
    (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
    event.target instanceof HTMLElement &&
    Boolean(event.target.closest("[role='slider']"));
}

export function KeyboardShortcuts({
  markers,
  playback
}: KeyboardShortcutsProps) {
  const returnToMarker = useCallback(() => {
    const marker = findReturnMarker(
      markers.sortedMarkers,
      markers.selectedMarkerId,
      playback.currentTime
    );

    if (!marker) {
      return;
    }

    markers.selectMarker(marker.id);
    playback.seekTo(marker.time);
  }, [markers, playback]);

  const handleShortcut = useCallback(
    (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        isTextEntryTarget(event.target) ||
        usesSliderNavigation(event)
      ) {
        return;
      }

      // Keep every control reachable by keyboard while reserving unmodified
      // transport keys for playback, including after a pointer click.
      if (event.altKey && !event.ctrlKey && !event.metaKey && event.key === "Enter" &&
          event.target instanceof HTMLElement) {
        const control = event.target.closest<HTMLElement>("button, [role='button'], a[href], summary, input[type='checkbox'], input[type='radio']");
        if (control) {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (!event.repeat) control.click();
          return;
        }
      }

      const command = getShortcutCommand(event);

      if (!command) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (event.repeat && (command.type === "togglePlayback" || command.type === "addMarker")) return;

      if (command.type === "togglePlayback") {
        playback.togglePlayback();
        return;
      }

      if (command.type === "seek") {
        playback.seekBySeconds(command.deltaSeconds);
        return;
      }

      if (command.type === "speed") {
        playback.changePlaybackRate(command.direction);
        return;
      }

      if (command.type === "addMarker") {
        markers.addMarkerAt(playback.currentTime, playback.duration);
        return;
      }

      returnToMarker();
    },
    [markers, playback, returnToMarker]
  );

  useEffect(() => {
    const shortcutListenerOptions = { capture: true } as const;

    window.addEventListener("keydown", handleShortcut, shortcutListenerOptions);

    return () => {
      window.removeEventListener(
        "keydown",
        handleShortcut,
        shortcutListenerOptions
      );
    };
  }, [handleShortcut]);

  return null;
}
