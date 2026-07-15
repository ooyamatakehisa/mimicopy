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

  return Boolean(
    target.closest("input, textarea, select, [contenteditable='true']")
  );
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
      if (isTextEntryTarget(event.target)) {
        return;
      }

      const command = getShortcutCommand(event);

      if (!command) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

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
