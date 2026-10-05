import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { AppHeader } from "../../components/layout/AppHeader";
import { SectionHeader, Surface } from "../../components/ui/Surface";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { decodePeaksFromArrayBuffer } from "../../lib/audio";
import { cn } from "../../lib/cn";
import {
  beatGridQueryKey,
  decodedTrackQueryKey,
  fetchMediaArrayBuffer,
  fetchTrackBeatAnalysis,
  fetchTrack,
  fetchTrackMixer,
  retryTrackBeatAnalysis,
  trackQueryKey
} from "../../lib/api";
import type { DecodedAudio } from "../../lib/audio";
import type { TrackDetail } from "../../lib/library";
import { useAutoNextTrack } from "./useAutoNextTrack";
import type { PlaybackSequence } from "./usePlaybackSequence";
import { KeyboardShortcuts } from "./KeyboardShortcuts";
import { MarkerPanel } from "./MarkerPanel";
import { PlaybackAudio } from "./PlaybackAudio";
import { StemMixer } from "./StemMixer";
import { TrackHeaderActions } from "./TrackHeaderActions";
import { TrackHeading } from "./TrackHeading";
import { TransportControls } from "./TransportControls";
import { useAudioPitchShift } from "./useAudioPitchShift";
import { useClickTrack } from "./useClickTrack";
import { useMarkersState } from "./useMarkersState";
import { usePlaybackState } from "./usePlaybackState";
import { useStemMixer } from "./useStemMixer";
import { useTranspose } from "./useTranspose";
import { useWaveformViewport } from "./useWaveformViewport";
import { WaveformPanel } from "./WaveformPanel";

type TrackEditorPageProps = {
  navigateToLibrary: () => void;
  trackId: string;
  sequence?: PlaybackSequence;
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
  trackId,
  sequence
}: TrackEditorPageProps) {
  const trackQuery = useQuery({
    queryFn: () => fetchTrack(trackId),
    queryKey: trackQueryKey(trackId),
    refetchInterval: (query) => {
      const separation = query.state.data?.separation;

      return separation?.status === "queued" ||
        separation?.status === "running"
        ? 3000
        : false;
    }
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

  const hasSeparatedMedia = track?.separation?.status === "completed" &&
    Boolean(track.separation.mediaUrl && track.separation.remainderMediaUrl);
  const mixerQuery = useQuery({
    enabled: hasSeparatedMedia,
    queryKey: ["track", trackId, "mixer", track?.separation?.mediaUrl, track?.separation?.remainderMediaUrl],
    queryFn: () => fetchTrackMixer(trackId),
    staleTime: Infinity
  });

  if ((!track && trackQuery.isLoading) || (!decodedQuery.data && decodedQuery.isLoading)) {
    return (
      <>
        <AppHeader
          subtitle="保存済みMP3を読み込み中"
          actions={<TrackHeaderActions onBack={navigateToLibrary} />}
          mobileActionsInline
          onNavigateHome={navigateToLibrary}
        />
        <TrackLoadingPanel message="保存済みMP3を読み込んでいます。" />
      </>
    );
  }

  if (!track || !decodedQuery.data) {
    return (
      <>
        <AppHeader
          subtitle="保存済みMP3を読み込めませんでした"
          actions={<TrackHeaderActions onBack={navigateToLibrary} />}
          mobileActionsInline
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
      sequence={sequence}
      mixerMediaUrl={hasSeparatedMedia ? mixerQuery.data ?? null : null}
      mixerPreparationMessage={hasSeparatedMedia && !mixerQuery.data
        ? mixerQuery.isError
          ? getErrorMessage(mixerQuery.error, "同期再生用の音源を準備できませんでした。")
          : "同期再生用の音源を準備しています。原音は引き続き再生できます。"
        : null}
      mixerPreparationFailed={mixerQuery.isError}
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
  mixerMediaUrl,
  mixerPreparationMessage,
  mixerPreparationFailed,
  navigateToLibrary,
  track,
  sequence
}: {
  decoded: DecodedAudio;
  mixerMediaUrl: string | null;
  mixerPreparationMessage: string | null;
  mixerPreparationFailed: boolean;
  navigateToLibrary: () => void;
  track: TrackDetail;
  sequence?: PlaybackSequence;
}) {
  const queryClient = useQueryClient();
  const beatGridQuery = useQuery({
    queryFn: () => fetchTrackBeatAnalysis(track.id),
    queryKey: beatGridQueryKey(track.id),
    refetchInterval: (query) => {
      const status = query.state.data?.status;

      return status === "queued" || status === "running" ? 1000 : false;
    }
  });
  const beatGridMutation = useMutation({
    mutationFn: () => retryTrackBeatAnalysis(track.id),
    onSuccess: (analysis) => {
      queryClient.setQueryData(beatGridQueryKey(track.id), analysis);
    }
  });
  const beatAnalysis = beatGridQuery.data ?? null;
  const beatGrid = beatGridQuery.data?.beatGrid ?? null;
  const autoNext = useAutoNextTrack(sequence);
  const playback = usePlaybackState({
    initialDuration: decoded.duration || track.duration,
    trackDuration: track.duration,
    trackId: track.id,
    onPlaybackEnded: autoNext.onPlaybackEnded
  });
  const mixer = useStemMixer();
  const transpose = useTranspose();
  const playbackMediaUrl = mixerMediaUrl ?? track.mediaUrl;
  const pitchShift = useAudioPitchShift({
    playback,
    mediaUrl: playbackMediaUrl,
    originalVolume: mixer.originalVolume,
    stemVolume: mixer.stemVolume,
    remainderVolume: mixer.remainderVolume,
    isMultichannel: Boolean(mixerMediaUrl),
    semitones: transpose.semitones
  });
  const markers = useMarkersState({
    initialMarkers: track.markers,
    trackId: track.id
  });
  const waveform = useWaveformViewport({
    currentTime: playback.currentTime,
    duration: playback.duration
  });
  const clickTrack = useClickTrack({
    audioContext: pitchShift.audioContext,
    beatGrid,
    outputLatencySeconds: pitchShift.outputLatencySeconds,
    playback
  });
  const beatGridErrorMessage =
    beatGridMutation.isError
      ? getErrorMessage(beatGridMutation.error, "拍解析に失敗しました。")
      : beatGridQuery.isError
        ? getErrorMessage(
            beatGridQuery.error,
            "拍解析の状態を読み込めませんでした。"
          )
        : beatAnalysis?.status === "failed"
          ? beatAnalysis.error ?? "拍解析に失敗しました。"
          : null;
  const errorMessage =
    playback.playbackError ??
    markers.markerSaveErrorMessage ??
    clickTrack.clickErrorMessage ??
    pitchShift.pitchShiftErrorMessage ??
    playback.durationErrorMessage;
  const description = markers.isSavingMarkers ? "マーカー保存中" : errorMessage ??
    (!pitchShift.audioContext ? "音声処理を準備しています。" : null);

  const hasPendingMixer = track.separation?.status === "completed" &&
    Boolean(track.separation.mediaUrl && track.separation.remainderMediaUrl) &&
    !mixerMediaUrl && !mixerPreparationFailed;

  const retryBeatAnalysis = () => {
    clickTrack.resetScheduledBeats();
    beatGridMutation.mutate();
  };

  return (
    <>
      <PlaybackAudio key={playbackMediaUrl} mediaUrl={playbackMediaUrl} playback={playback}
        autoPlay={sequence?.autoPlayRequested === true && Boolean(pitchShift.audioContext) && !hasPendingMixer}
        onAutoPlayConsumed={sequence?.consumeAutoPlay} />
      <KeyboardShortcuts markers={markers} playback={playback} />
      <Surface
        className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-4 overflow-hidden rounded-2xl max-lg:contents"
        aria-label="Audio editor"
      >
        <TrackHeading title={track.title} trackId={track.id} currentTime={playback.currentTime}
          duration={playback.duration} message={description} onBack={navigateToLibrary} />

        <div
          className={cn(
            "grid min-h-0 max-lg:contents",
            track.separation
              ? "grid-rows-[auto_minmax(0,1fr)]"
              : "grid-rows-[minmax(0,1fr)]"
          )}
        >
          {track.separation ? (
            <StemMixer
              mixer={mixer}
              mixerReady={Boolean(mixerMediaUrl)}
              preparationMessage={mixerPreparationMessage}
              preparationFailed={mixerPreparationFailed}
              originalMediaUrl={track.mediaUrl}
              separation={track.separation}
              trackTitle={track.title}
            />
          ) : null}
          <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_minmax(320px,390px)] items-stretch gap-4 p-4 max-lg:contents">
            <WaveformPanel
              beatGrid={beatGrid}
              currentTime={playback.currentTime}
              duration={playback.duration}
              message={errorMessage}
              moveMarkerTo={(markerId, time) =>
                markers.moveMarkerTo(markerId, time, playback.duration)
              }
              peaks={decoded.peaks}
              seekTo={playback.seekTo}
              selectMarker={markers.selectMarker}
              selectedMarkerId={markers.selectedMarkerId}
              scaleWaveformZoomContinuously={
                waveform.scaleWaveformZoomContinuously
              }
              sortedMarkers={markers.sortedMarkers}
              waveformRange={waveform.waveformRange}
              panWaveform={waveform.panWaveform}
              followPlayback={waveform.followPlayback}
              isFollowingPlayback={waveform.isFollowingPlayback}
            />
            <MarkerPanel markers={markers} playback={playback} />
          </div>
        </div>
      </Surface>

      <TransportControls
        autoNext={autoNext}
        beatGrid={beatGrid}
        beatAnalysis={beatAnalysis}
        beatGridErrorMessage={beatGridErrorMessage}
        clickTrack={clickTrack}
        isAnalyzingBeatGrid={beatGridMutation.isPending}
        isLoadingBeatGrid={beatGridQuery.isLoading}
        isPlaybackReady={Boolean(pitchShift.audioContext)}
        onRetryBeatAnalysis={retryBeatAnalysis}
        markers={markers}
        playback={playback}
        transpose={transpose}
        waveform={waveform}
      />
    </>
  );
}
