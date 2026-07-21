import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, LoaderCircle, Pencil, X } from "lucide-react";
import { AppHeader } from "../../components/layout/AppHeader";
import { IconButton } from "../../components/ui/Button";
import { SectionHeader, Surface } from "../../components/ui/Surface";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { TextInput } from "../../components/ui/TextInput";
import { decodePeaksFromArrayBuffer } from "../../lib/audio";
import {
  analyzeTrackBeatGrid,
  beatGridQueryKey,
  decodedTrackQueryKey,
  fetchMediaArrayBuffer,
  fetchTrack,
  trackQueryKey,
  updateTrackTitle
} from "../../lib/api";
import type { DecodedAudio } from "../../lib/audio";
import type { BeatGrid } from "../../lib/beats";
import type { TrackDetail } from "../../lib/library";
import { formatTime } from "../../lib/playback";
import { cacheTrack } from "../../lib/trackQueryCache";
import { KeyboardShortcuts } from "./KeyboardShortcuts";
import { MarkerPanel } from "./MarkerPanel";
import { PlaybackAudio } from "./PlaybackAudio";
import { TrackHeaderActions } from "./TrackHeaderActions";
import { TransportControls } from "./TransportControls";
import { useClickTrack } from "./useClickTrack";
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
  const queryClient = useQueryClient();
  const titleMutation = useMutation({
    mutationFn: updateTrackTitle,
    onSuccess: (updatedTrack) => {
      cacheTrack(queryClient, updatedTrack);
    }
  });
  const beatGridMutation = useMutation({
    mutationFn: analyzeTrackBeatGrid,
    onSuccess: (beatGrid) => {
      queryClient.setQueryData(beatGridQueryKey(track.id), beatGrid);
    }
  });
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
  const cachedBeatGrid =
    queryClient.getQueryData<BeatGrid>(beatGridQueryKey(track.id)) ?? null;
  const beatGrid = beatGridMutation.data ?? cachedBeatGrid;
  const clickTrack = useClickTrack({ beatGrid, playback });
  const beatGridErrorMessage = beatGridMutation.isError
    ? getErrorMessage(beatGridMutation.error, "拍解析に失敗しました。")
    : null;
  const message =
    playback.playbackError ??
    markers.markerSaveErrorMessage ??
    beatGridErrorMessage ??
    clickTrack.clickErrorMessage ??
    playback.durationErrorMessage ??
    `${track.title} を読み込みました。`;
  const loadState =
    playback.playbackError ||
    markers.markerSaveErrorMessage ||
    beatGridErrorMessage ||
    clickTrack.clickErrorMessage ||
    playback.durationErrorMessage
      ? "error"
      : "ready";
  const titleMessage = titleMutation.isPending
    ? `${titleMutation.variables?.title.trim() ?? track.title} を保存しています。`
    : titleMutation.isError
      ? getErrorMessage(titleMutation.error, "表示名を保存できませんでした。")
      : titleMutation.isSuccess
        ? `${titleMutation.data.title} に変更しました。`
        : null;
  const description =
    titleMessage ?? (markers.isSavingMarkers ? "マーカー保存中" : message);

  const renameTrack = async (title: string) => {
    const trimmedTitle = title.trim();

    if (!trimmedTitle || trimmedTitle === track.title) {
      return true;
    }

    try {
      await titleMutation.mutateAsync({
        title: trimmedTitle,
        trackId: track.id
      });
      return true;
    } catch {
      return false;
    }
  };

  const analyzeBeatGrid = () => {
    clickTrack.resetScheduledBeats();
    beatGridMutation.mutate(track.id);
  };

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
          description={description}
          action={
            <div className="flex w-full min-w-0 flex-wrap items-center justify-end gap-2">
              <TrackTitleActions
                title={track.title}
                isSaving={titleMutation.isPending}
                onRename={renameTrack}
                onStartEditing={titleMutation.reset}
              />
              <span className="whitespace-nowrap text-sm font-bold tabular-nums text-ink">
                {formatTime(playback.currentTime)} /{" "}
                {formatTime(playback.duration)}
              </span>
            </div>
          }
        />

        <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_minmax(320px,390px)] items-stretch gap-4 p-4 max-lg:grid-cols-1">
          <WaveformPanel
            beatGrid={beatGrid}
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
        beatGrid={beatGrid}
        beatGridErrorMessage={beatGridErrorMessage}
        clickTrack={clickTrack}
        isAnalyzingBeatGrid={beatGridMutation.isPending}
        onAnalyzeBeatGrid={analyzeBeatGrid}
        markers={markers}
        playback={playback}
        waveform={waveform}
      />
    </>
  );
}

function TrackTitleActions({
  isSaving,
  onRename,
  onStartEditing,
  title
}: {
  isSaving: boolean;
  onRename: (title: string) => Promise<boolean>;
  onStartEditing: () => void;
  title: string;
}) {
  const [draftTitle, setDraftTitle] = useState(title);
  const [isEditing, setIsEditing] = useState(false);
  const trimmedTitle = draftTitle.trim();

  useEffect(() => {
    if (!isEditing) {
      setDraftTitle(title);
    }
  }, [isEditing, title]);

  const startEditing = () => {
    onStartEditing();
    setDraftTitle(title);
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setDraftTitle(title);
    setIsEditing(false);
  };

  const saveTitle = async () => {
    if (!trimmedTitle) {
      return;
    }

    if (await onRename(trimmedTitle)) {
      setDraftTitle(trimmedTitle);
      setIsEditing(false);
    }
  };

  if (!isEditing) {
    return (
      <IconButton title="表示名を編集" onClick={startEditing}>
        <Pencil size={16} />
      </IconButton>
    );
  }

  return (
    <div className="grid min-w-0 flex-1 grid-cols-[minmax(160px,260px)_auto_auto] items-center gap-2 max-sm:grid-cols-[minmax(0,1fr)_auto_auto]">
      <TextInput
        aria-label={`${title} display name`}
        autoFocus
        className="h-10 rounded-2xl text-base font-semibold"
        disabled={isSaving}
        maxLength={180}
        value={draftTitle}
        onChange={(event) => setDraftTitle(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void saveTitle();
          }

          if (event.key === "Escape") {
            event.preventDefault();
            cancelEditing();
          }
        }}
      />
      <IconButton
        className="size-10"
        disabled={!trimmedTitle || isSaving}
        title="表示名を保存"
        onClick={() => void saveTitle()}
      >
        {isSaving ? (
          <LoaderCircle className="animate-spin" size={16} />
        ) : (
          <Check size={16} />
        )}
      </IconButton>
      <IconButton
        className="size-10"
        disabled={isSaving}
        title="表示名の編集をキャンセル"
        onClick={cancelEditing}
      >
        <X size={16} />
      </IconButton>
    </div>
  );
}
