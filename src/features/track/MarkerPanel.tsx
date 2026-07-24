import { Clock3, MapPin, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import { IconButton } from "../../components/ui/Button";
import { SectionHeader } from "../../components/ui/Surface";
import { TextInput } from "../../components/ui/TextInput";
import { cn } from "../../lib/cn";
import { findReturnMarker } from "../../lib/markers";
import { formatTime, parseTimeInput } from "../../lib/playback";
import type { MarkersState } from "./useMarkersState";
import type { PlaybackState } from "./usePlaybackState";

type MarkerPanelProps = {
  markers: MarkersState;
  playback: PlaybackState;
};

export function MarkerPanel({ markers, playback }: MarkerPanelProps) {
  const [markerInput, setMarkerInput] = useState("0:00");
  const [markerTimeDrafts, setMarkerTimeDrafts] = useState<
    Record<string, string>
  >({});

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

  const addMarkerFromInput = useCallback(() => {
    const parsedTime = parseTimeInput(markerInput, playback.duration);
    const marker = markers.addMarkerAt(
      parsedTime ?? playback.currentTime,
      playback.duration
    );

    setMarkerInput(formatTime(marker.time));
  }, [markerInput, markers, playback.currentTime, playback.duration]);

  const changeMarkerTimeInput = useCallback(
    (markerId: string, value: string) => {
      setMarkerTimeDrafts((currentDrafts) => ({
        ...currentDrafts,
        [markerId]: value
      }));

      const parsedTime = parseTimeInput(value, playback.duration);

      if (parsedTime !== null) {
        markers.moveMarkerTo(markerId, parsedTime, playback.duration);
      }
    },
    [markers, playback.duration]
  );

  const finishMarkerTimeInput = useCallback((markerId: string) => {
    setMarkerTimeDrafts((currentDrafts) => {
      const { [markerId]: _markerDraft, ...nextDrafts } = currentDrafts;

      return nextDrafts;
    });
  }, []);

  return (
    <aside
      className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden rounded-[2rem] border border-white/8 bg-white/[0.04] max-lg:order-2 max-lg:min-h-[330px]"
      aria-label="Markers"
    >
      <SectionHeader
        title="Markers"
        description={markers.selectedMarker ? markers.selectedMarker.label : "No selection"}
        action={
          <IconButton
            title="選択マーカーへ戻る"
            disabled={markers.sortedMarkers.length === 0}
            onClick={returnToMarker}
          >
            <RotateCcw size={18} />
          </IconButton>
        }
      />

      <div className="mx-3 grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-[1.5rem] border border-white/8 bg-black/18 p-2.5 focus-within:border-teal/55 focus-within:shadow-[0_0_0_4px_rgba(67,224,202,0.1)] max-sm:grid-cols-1">
        <MapPin className="text-muted" size={18} aria-hidden="true" />
        <label className="sr-only" htmlFor="marker-time">
          Marker time
        </label>
        <TextInput
          id="marker-time"
          value={markerInput}
          onChange={(event) => setMarkerInput(event.target.value)}
          placeholder="1:23"
        />
        <IconButton
          title="現在位置を入力"
          onClick={() => setMarkerInput(formatTime(playback.currentTime))}
        >
          <Clock3 size={18} />
        </IconButton>
        <IconButton
          variant="accent"
          title="入力時刻にマーカー追加"
          onClick={addMarkerFromInput}
        >
          <Plus size={18} />
        </IconButton>
      </div>

      <div className="min-h-0 overflow-auto p-3">
        {markers.sortedMarkers.length === 0 ? (
          <div className="grid min-h-32 place-items-center rounded-[1.5rem] border border-dashed border-white/14 bg-white/[0.035] text-center text-quiet">
            No markers
          </div>
        ) : (
          markers.sortedMarkers.map((marker) => (
            <div
              key={marker.id}
              className={cn(
                "mb-2 grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-[1.5rem] border border-white/8 bg-white/[0.055] transition-[background,border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-white/16 hover:bg-white/[0.075] hover:shadow-tight max-sm:grid-cols-1",
                marker.id === markers.selectedMarkerId &&
                  "border-coral/45 bg-coral/12"
              )}
            >
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_80px] items-center gap-2 py-2 pl-2 max-sm:grid-cols-1 max-sm:p-2">
                <TextInput
                  aria-label={`${marker.label} label`}
                  className="markerLabelInput"
                  value={marker.label}
                  onBlur={() => markers.finishRenamingMarker(marker.id)}
                  onChange={(event) =>
                    markers.renameMarker(marker.id, event.target.value)
                  }
                />
                <TextInput
                  aria-label={`${marker.label} time`}
                  className="markerTimeInput text-right tabular-nums"
                  inputMode="numeric"
                  value={
                    markerTimeDrafts[marker.id] ?? formatTime(marker.time)
                  }
                  onBlur={() => finishMarkerTimeInput(marker.id)}
                  onChange={(event) =>
                    changeMarkerTimeInput(marker.id, event.target.value)
                  }
                />
              </div>
              <IconButton
                className="max-sm:w-full"
                title="マーカーへ移動"
                onClick={() => {
                  markers.selectMarker(marker.id);
                  playback.seekTo(marker.time);
                }}
              >
                <MapPin size={17} />
              </IconButton>
              <IconButton
                className="mr-2 max-sm:mx-2 max-sm:mb-2 max-sm:w-auto"
                variant="danger"
                title="マーカー削除"
                onClick={() => {
                  markers.deleteMarker(marker.id);
                  finishMarkerTimeInput(marker.id);
                }}
              >
                <Trash2 size={17} />
              </IconButton>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
