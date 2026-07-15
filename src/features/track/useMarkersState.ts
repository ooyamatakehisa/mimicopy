import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { saveTrackMarkers } from "../../lib/api";
import {
  createMarker,
  removeMarker,
  sortMarkers,
  updateMarker,
  type Marker
} from "../../lib/markers";
import { clampTime } from "../../lib/playback";
import { cacheTrack } from "../../lib/trackQueryCache";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function useMarkersState({
  initialMarkers,
  trackId
}: {
  initialMarkers: Marker[];
  trackId: string;
}) {
  const queryClient = useQueryClient();
  const markerSaveTimeoutRef = useRef<number | null>(null);
  const [markers, setMarkers] = useState<Marker[]>(() =>
    sortMarkers(initialMarkers)
  );
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const {
    error: markerSaveError,
    isPending: isSavingMarkers,
    mutate: saveMarkers
  } = useMutation({
    mutationFn: saveTrackMarkers,
    onSuccess: (updatedTrack) => {
      cacheTrack(queryClient, updatedTrack);
    }
  });
  const markerSaveErrorMessage = markerSaveError
    ? getErrorMessage(markerSaveError, "マーカーを保存できませんでした。")
    : null;

  const sortedMarkers = useMemo(() => sortMarkers(markers), [markers]);
  const selectedMarker = useMemo(
    () => sortedMarkers.find((marker) => marker.id === selectedMarkerId) ?? null,
    [selectedMarkerId, sortedMarkers]
  );

  const scheduleMarkerSave = useCallback(
    (nextMarkers: Marker[]) => {
      if (markerSaveTimeoutRef.current !== null) {
        window.clearTimeout(markerSaveTimeoutRef.current);
      }

      markerSaveTimeoutRef.current = window.setTimeout(() => {
        markerSaveTimeoutRef.current = null;
        saveMarkers({
          markers: nextMarkers,
          trackId
        });
      }, 500);
    },
    [saveMarkers, trackId]
  );

  const commitMarkers = useCallback(
    (updater: (currentMarkers: Marker[]) => Marker[]) => {
      setMarkers((currentMarkers) => {
        const nextMarkers = sortMarkers(updater(currentMarkers));

        scheduleMarkerSave(nextMarkers);

        return nextMarkers;
      });
    },
    [scheduleMarkerSave]
  );

  const addMarkerAt = useCallback(
    (time: number, duration: number) => {
      const nextTime = clampTime(time, duration);
      const marker = createMarker(
        crypto.randomUUID(),
        nextTime,
        sortedMarkers.length
      );

      commitMarkers((currentMarkers) => [...currentMarkers, marker]);
      setSelectedMarkerId(marker.id);

      return marker;
    },
    [commitMarkers, sortedMarkers.length]
  );

  const renameMarker = useCallback(
    (markerId: string, label: string) => {
      commitMarkers((currentMarkers) =>
        updateMarker(currentMarkers, markerId, { label })
      );
    },
    [commitMarkers]
  );

  const finishRenamingMarker = useCallback(
    (markerId: string) => {
      commitMarkers((currentMarkers) =>
        currentMarkers.map((marker) =>
          marker.id === markerId && marker.label.trim().length === 0
            ? { ...marker, label: "Marker" }
            : marker
        )
      );
    },
    [commitMarkers]
  );

  const moveMarkerTo = useCallback(
    (markerId: string, time: number, duration: number) => {
      const nextTime = clampTime(time, duration);

      commitMarkers((currentMarkers) =>
        updateMarker(currentMarkers, markerId, { time: nextTime })
      );
      setSelectedMarkerId(markerId);
    },
    [commitMarkers]
  );

  const deleteMarker = useCallback(
    (markerId: string) => {
      commitMarkers((currentMarkers) => removeMarker(currentMarkers, markerId));
      setSelectedMarkerId((currentMarkerId) =>
        currentMarkerId === markerId ? null : currentMarkerId
      );
    },
    [commitMarkers]
  );

  useEffect(() => {
    return () => {
      if (markerSaveTimeoutRef.current !== null) {
        window.clearTimeout(markerSaveTimeoutRef.current);
      }
    };
  }, []);

  return useMemo(
    () => ({
      addMarkerAt,
      deleteMarker,
      finishRenamingMarker,
      isSavingMarkers,
      markerSaveErrorMessage,
      moveMarkerTo,
      renameMarker,
      selectMarker: setSelectedMarkerId,
      selectedMarker,
      selectedMarkerId,
      sortedMarkers
    }),
    [
      addMarkerAt,
      deleteMarker,
      finishRenamingMarker,
      isSavingMarkers,
      markerSaveErrorMessage,
      moveMarkerTo,
      renameMarker,
      selectedMarker,
      selectedMarkerId,
      sortedMarkers
    ]
  );
}

export type MarkersState = ReturnType<typeof useMarkersState>;
