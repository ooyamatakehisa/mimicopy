import { useQuery } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { AppHeader } from "../../components/layout/AppHeader";
import { SectionHeader, Surface } from "../../components/ui/Surface";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { decodePeaksFromArrayBuffer } from "../../lib/audio";
import {
  decodedTrackQueryKey,
  fetchMediaArrayBuffer,
  fetchTrack,
  trackQueryKey
} from "../../lib/api";
import type { DecodedAudio } from "../../lib/audio";
import type { TrackDetail } from "../../lib/library";
import { formatTime } from "../../lib/playback";
import { KeyboardShortcuts } from "./KeyboardShortcuts";
import { MarkerPanel } from "./MarkerPanel";
import { PlaybackAudio } from "./PlaybackAudio";
import { TrackHeaderActions } from "./TrackHeaderActions";
import { TransportControls } from "./TransportControls";
import { useMarkersState } from "./useMarkersState";
import { usePlaybackState } from "./usePlaybackState";
import { useWaveformViewport } from "./useWaveformViewport";
import { WaveformPanel } from "./WaveformPanel";

type TrackEditorPageProps = {
  navigateToLibrary: () => void;
  trackId: string;
};

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

async function decodeTrackMedia(mediaUrl: string) {
  const arrayBuffer = await fetchMediaArrayBuffer(
    mediaUrl,
    "保存済みMP3ファイルを読み込めませんでした。"
  );

  return decodePeaksFromArrayBuffer(arrayBuffer);
}

export function TrackEditorPage({
  navigateToLibrary,
  trackId
}: TrackEditorPageProps) {
  const trackQuery = useQuery({
    queryFn: () => fetchTrack(trackId),
    queryKey: trackQueryKey(trackId)
  });
  const track = trackQuery.data ?? null;
  const decodedQuery = useQuery({
    enabled: Boolean(track),
    queryFn: () => {
      if (!track) {
        throw new Error("曲情報を読み込めませんでした。");
      }

      return decodeTrackMedia(track.mediaUrl);
    },
    queryKey: track
      ? decodedTrackQueryKey(track.id, track.mediaUrl)
      : ["track", trackId, "decoded"]
  });

  if (trackQuery.isLoading || decodedQuery.isLoading) {
    return (
      <>
        <AppHeader
          subtitle="保存済みMP3を読み込み中"
          actions={<TrackHeaderActions onBack={navigateToLibrary} />}
          onNavigateHome={navigateToLibrary}
        />
        <TrackLoadingPanel message="保存済みMP3を読み込んでいます。" />
      </>
    );
  }

  if (trackQuery.isError || decodedQuery.isError || !track || !decodedQuery.data) {
    return (
      <>
        <AppHeader
          subtitle="保存済みMP3を読み込めませんでした"
          actions={<TrackHeaderActions onBack={navigateToLibrary} />}
          onNavigateHome={navigateToLibrary}
        />
        <TrackLoadingPanel
          state="error"
          message={getErrorMessage(
            trackQuery.error ?? decodedQuery.error,
            "保存済みMP3を読み込めませんでした。"
          )}
        />
      </>
    );
  }

  return (
    <TrackEditor
      key={track.id}
      track={track}
      decoded={decodedQuery.data}
      navigateToLibrary={navigateToLibrary}
    />
  );
}

function TrackLoadingPanel({
  message,
  state = "loading"
}: {
  message: string;
  state?: "error" | "loading";
}) {
  return (
    <Surface
      className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-[2.25rem]"
      aria-label="Audio editor"
    >
      <SectionHeader
        title="曲を読み込み中"
        description={message}
        action={
          state === "loading" ? (
            <LoaderCircle className="animate-spin text-muted" size={20} />
          ) : null
        }
      />
      <div className="m-4 grid min-h-[360px] place-items-center rounded-[2rem] border border-white/8 bg-white/[0.035] text-muted">
        <div className="flex items-center gap-3 text-sm">
          <StatusBadge state={state}>{state}</StatusBadge>
          <span>{message}</span>
        </div>
      </div>
    </Surface>
  );
}

function TrackEditor({
  decoded,
  navigateToLibrary,
  track
}: {
  decoded: DecodedAudio;
  navigateToLibrary: () => void;
  track: TrackDetail;
}) {
  const playback = usePlaybackState({
    initialDuration: decoded.duration || track.duration,
    trackDuration: track.duration,
    trackId: track.id
  });
  const markers = useMarkersState({
    initialMarkers: track.markers,
    trackId: track.id
  });
  const waveform = useWaveformViewport({
    currentTime: playback.currentTime,
    duration: playback.duration
  });
  const message =
    playback.playbackError ??
    markers.markerSaveErrorMessage ??
    playback.durationErrorMessage ??
    `${track.title} を読み込みました。`;
  const loadState =
    playback.playbackError ||
    markers.markerSaveErrorMessage ||
    playback.durationErrorMessage
      ? "error"
      : "ready";

  return (
    <>
      <PlaybackAudio mediaUrl={track.mediaUrl} playback={playback} />
      <KeyboardShortcuts markers={markers} playback={playback} />
      <AppHeader
        subtitle={`${track.title} ・ ${
          markers.isSavingMarkers ? "マーカー保存中" : "保存済み"
        }`}
        actions={<TrackHeaderActions onBack={navigateToLibrary} />}
        onNavigateHome={navigateToLibrary}
      />

      <Surface
        className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-[2.25rem]"
        aria-label="Audio editor"
      >
        <SectionHeader
          title={track.title}
          description={markers.isSavingMarkers ? "マーカー保存中" : message}
          action={
            <span className="whitespace-nowrap text-sm font-bold tabular-nums text-ink">
              {formatTime(playback.currentTime)} / {formatTime(playback.duration)}
            </span>
          }
        />

        <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_minmax(320px,390px)] items-stretch gap-4 p-4 max-lg:grid-cols-1">
          <WaveformPanel
            currentTime={playback.currentTime}
            duration={playback.duration}
            loadState={loadState}
            message={message}
            moveMarkerTo={(markerId, time) =>
              markers.moveMarkerTo(markerId, time, playback.duration)
            }
            peaks={decoded.peaks}
            seekTo={playback.seekTo}
            selectMarker={markers.selectMarker}
            selectedMarkerId={markers.selectedMarkerId}
            sortedMarkers={markers.sortedMarkers}
            waveformRange={waveform.waveformRange}
          />
          <MarkerPanel markers={markers} playback={playback} />
        </div>
      </Surface>

      <TransportControls
        markers={markers}
        playback={playback}
        waveform={waveform}
      />
    </>
  );
}
