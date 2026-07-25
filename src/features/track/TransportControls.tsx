import {
  AudioLines,
  Gauge,
  MapPin,
  Minus,
  Music2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import { Button, IconButton } from "../../components/ui/Button";
import { Surface } from "../../components/ui/Surface";
import type { BeatGrid, TrackBeatAnalysis } from "../../lib/beats";
import {
  formatWaveformZoom,
  maxWaveformZoom,
  minWaveformZoom
} from "../../lib/waveform";
import {
  formatTransposeSemitones,
  maxTransposeSemitones,
  minTransposeSemitones
} from "../../lib/transpose";
import type { MarkersState } from "./useMarkersState";
import type { ClickTrackState } from "./useClickTrack";
import type { PlaybackState } from "./usePlaybackState";
import type { TransposeState } from "./useTranspose";
import type { WaveformViewportState } from "./useWaveformViewport";

type TransportControlsProps = {
  beatAnalysis: TrackBeatAnalysis | null;
  beatGrid: BeatGrid | null;
  beatGridErrorMessage: string | null;
  clickTrack: ClickTrackState;
  isAnalyzingBeatGrid: boolean;
  isLoadingBeatGrid: boolean;
  markers: MarkersState;
  onRetryBeatAnalysis: () => void;
  playback: PlaybackState;
  transpose: TransposeState;
  waveform: WaveformViewportState;
};

export function TransportControls({
  beatAnalysis,
  beatGrid,
  beatGridErrorMessage,
  clickTrack,
  isAnalyzingBeatGrid,
  isLoadingBeatGrid,
  markers,
  onRetryBeatAnalysis,
  playback,
  transpose,
  waveform
}: TransportControlsProps) {
  const isAutomaticAnalysisPending =
    beatAnalysis?.status === "queued" || beatAnalysis?.status === "running";
  const isBeatAnalysisBusy =
    isAnalyzingBeatGrid || isLoadingBeatGrid || isAutomaticAnalysisPending;
  const beatStatus = beatGrid
    ? `${beatGrid.beats.length} beats / ${beatGrid.downbeats.length} downbeats`
    : beatGridErrorMessage ||
      clickTrack.clickErrorMessage ||
      (beatAnalysis?.status === "queued"
        ? "Analysis queued"
        : beatAnalysis?.status === "running"
          ? "Analyzing track..."
          : "Preparing analysis...");

  return (
    <Surface
      as="footer"
      className="flex min-h-[76px] flex-wrap items-center justify-between gap-4 rounded-full px-4 py-3 max-xl:rounded-[2rem] max-lg:order-1 max-lg:flex-col max-lg:items-stretch"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button
          size="transport"
          variant="primary"
          title={playback.isPlaying ? "停止" : "再生"}
          onClick={playback.togglePlayback}
        >
          {playback.isPlaying ? <Pause size={21} /> : <Play size={21} />}
          <span>{playback.isPlaying ? "停止" : "再生"}</span>
        </Button>
        <Button
          size="transport"
          title="5秒戻る"
          onClick={() => playback.seekBySeconds(-5)}
        >
          <span>-5s</span>
        </Button>
        <Button
          size="transport"
          title="5秒進む"
          onClick={() => playback.seekBySeconds(5)}
        >
          <span>+5s</span>
        </Button>
        <Button
          size="transport"
          title="10秒戻る"
          onClick={() => playback.seekBySeconds(-10)}
        >
          <span>-10s</span>
        </Button>
        <Button
          size="transport"
          title="10秒進む"
          onClick={() => playback.seekBySeconds(10)}
        >
          <span>+10s</span>
        </Button>
        <Button
          size="transport"
          variant="accent"
          title="現在位置にマーカー追加"
          onClick={() =>
            markers.addMarkerAt(playback.currentTime, playback.duration)
          }
        >
          <MapPin size={18} />
          <span>Marker</span>
        </Button>
      </div>

      <div
        className="flex min-w-[300px] max-w-[520px] flex-1 items-center justify-end gap-2 rounded-full border border-white/8 bg-white/[0.04] p-1 max-lg:w-full max-lg:min-w-0 max-lg:justify-start"
        aria-label="Click track"
      >
        <AudioLines className="text-muted" size={18} aria-hidden="true" />
        <IconButton
          title="この曲のクリック解析を再実行"
          disabled={isBeatAnalysisBusy}
          onClick={onRetryBeatAnalysis}
        >
          <RefreshCw
            className={isBeatAnalysisBusy ? "animate-spin" : undefined}
            size={17}
          />
        </IconButton>
        <Button
          className="min-w-24"
          size="transport"
          variant={clickTrack.isClickEnabled ? "accent" : "secondary"}
          title="クリック音をオン/オフ"
          aria-pressed={clickTrack.isClickEnabled}
          disabled={!beatGrid || isBeatAnalysisBusy}
          onClick={clickTrack.toggleClickTrack}
        >
          {clickTrack.isClickEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
          <span>Click</span>
        </Button>
        <strong className="min-w-40 flex-1 truncate text-center text-xs font-semibold text-muted">
          {isLoadingBeatGrid ? "Loading analysis..." : beatStatus}
        </strong>
      </div>

      <div
        className="flex min-w-44 items-center justify-end gap-2 rounded-full border border-white/8 bg-white/[0.04] p-1 max-lg:w-full max-lg:justify-start"
        aria-label="Waveform zoom"
      >
        <ZoomOut className="text-muted" size={18} aria-hidden="true" />
        <IconButton
          title="波形を縮小"
          disabled={waveform.waveformZoom <= minWaveformZoom}
          onClick={() => waveform.changeWaveformZoom("out")}
        >
          <ZoomOut size={17} />
        </IconButton>
        <strong className="min-w-11 text-center tabular-nums text-ink">
          {formatWaveformZoom(waveform.waveformZoom)}
        </strong>
        <IconButton
          title="波形を拡大"
          disabled={waveform.waveformZoom >= maxWaveformZoom}
          onClick={() => waveform.changeWaveformZoom("in")}
        >
          <ZoomIn size={17} />
        </IconButton>
      </div>

      <div
        className="flex min-w-44 items-center justify-end gap-2 rounded-full border border-white/8 bg-white/[0.04] p-1 max-lg:w-full max-lg:justify-start"
        aria-label="Transpose"
      >
        <Music2 className="text-muted" size={18} aria-hidden="true" />
        <IconButton
          title="半音下げる"
          disabled={transpose.semitones <= minTransposeSemitones}
          onClick={() => transpose.changeTranspose("down")}
        >
          <Minus size={17} />
        </IconButton>
        <Button
          className="h-10 min-w-12 px-2 tabular-nums"
          title="転調を0に戻す"
          aria-label={`転調 ${formatTransposeSemitones(
            transpose.semitones
          )} 半音。0に戻す`}
          onClick={transpose.resetTranspose}
        >
          <strong>{formatTransposeSemitones(transpose.semitones)}</strong>
        </Button>
        <IconButton
          title="半音上げる"
          disabled={transpose.semitones >= maxTransposeSemitones}
          onClick={() => transpose.changeTranspose("up")}
        >
          <Plus size={17} />
        </IconButton>
      </div>

      <div
        className="flex min-w-44 items-center justify-end gap-2 rounded-full border border-white/8 bg-white/[0.04] p-1 max-lg:w-full max-lg:justify-start"
        aria-label="Playback speed"
      >
        <Gauge className="text-muted" size={18} aria-hidden="true" />
        <IconButton
          title="速度を下げる"
          onClick={() => playback.changePlaybackRate("slower")}
        >
          <span>,</span>
        </IconButton>
        <strong className="min-w-11 text-center tabular-nums text-ink">
          {playback.playbackRate}x
        </strong>
        <IconButton
          title="速度を上げる"
          onClick={() => playback.changePlaybackRate("faster")}
        >
          <span>.</span>
        </IconButton>
      </div>
    </Surface>
  );
}
