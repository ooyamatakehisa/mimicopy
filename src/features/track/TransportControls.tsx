import type { AutoNextTrack } from "./useAutoNextTrack";
import { Gauge, MapPin, Minus, Music2, Pause, Play, Plus, RefreshCw, Volume2, VolumeX, ZoomIn, ZoomOut } from "lucide-react";
import { Button, IconButton } from "../../components/ui/Button";
import { Surface } from "../../components/ui/Surface";
import type { BeatGrid, TrackBeatAnalysis } from "../../lib/beats";
import { cn } from "../../lib/cn";
import { playbackRates } from "../../lib/playback";
import { formatWaveformZoom, maxWaveformZoom, minWaveformZoom } from "../../lib/waveform";
import { formatTransposeSemitones, maxTransposeSemitones, minTransposeSemitones } from "../../lib/transpose";
import type { MarkersState } from "./useMarkersState";
import type { ClickTrackState } from "./useClickTrack";
import type { PlaybackState } from "./usePlaybackState";
import type { TransposeState } from "./useTranspose";
import type { WaveformViewportState } from "./useWaveformViewport";

type TransportControlsProps = {
  autoNext: AutoNextTrack;
  beatAnalysis: TrackBeatAnalysis | null;
  beatGrid: BeatGrid | null;
  beatGridErrorMessage: string | null;
  clickTrack: ClickTrackState;
  isAnalyzingBeatGrid: boolean;
  isLoadingBeatGrid: boolean;
  isPlaybackReady: boolean;
  markers: MarkersState;
  onRetryBeatAnalysis: () => void;
  playback: PlaybackState;
  transpose: TransposeState;
  waveform: WaveformViewportState;
};

export function TransportControls({ autoNext, beatAnalysis, beatGrid, beatGridErrorMessage, clickTrack,
  isAnalyzingBeatGrid, isLoadingBeatGrid, isPlaybackReady, markers, onRetryBeatAnalysis,
  playback, transpose, waveform }: TransportControlsProps) {
  const isBeatAnalysisBusy = isAnalyzingBeatGrid || isLoadingBeatGrid ||
    beatAnalysis?.status === "queued" || beatAnalysis?.status === "running";
  const beatStatus = beatGrid
    ? `${beatGrid.beats.length} beats / ${beatGrid.downbeats.length} downbeats`
    : beatGridErrorMessage || clickTrack.clickErrorMessage || "クリック音を解析中…";

  return (
    <Surface as="footer" aria-label="再生コントロール"
      className="grid grid-cols-1 gap-2 rounded-2xl p-3 min-[380px]:grid-cols-2 max-lg:order-1 lg:flex lg:flex-wrap lg:items-center lg:gap-3">
      <div className="col-span-full grid min-w-0 grid-cols-3 gap-2 lg:flex lg:flex-wrap">
        <Button size="transport" className="min-w-0 gap-1 whitespace-nowrap px-2" variant="primary" title={playback.isPlaying || playback.isPlayPending ? "停止" : "再生"}
          disabled={!isPlaybackReady} onClick={playback.togglePlayback}>
          {playback.isPlaying || playback.isPlayPending ? <Pause size={21} /> : <Play size={21} />}
          {playback.isPlaying || playback.isPlayPending ? "停止" : "再生"}
        </Button>
        <Button size="transport" title="5秒戻る" onClick={() => playback.seekBySeconds(-5)}>-5s</Button>
        <Button size="transport" title="5秒進む" onClick={() => playback.seekBySeconds(5)}>+5s</Button>
        <Button size="transport" title="10秒戻る" onClick={() => playback.seekBySeconds(-10)}>-10s</Button>
        <Button size="transport" title="10秒進む" onClick={() => playback.seekBySeconds(10)}>+10s</Button>
        <Button size="transport" className="min-w-0 px-2" variant="accent" title="現在位置にマーカー追加"
          onClick={() => markers.addMarkerAt(playback.currentTime, playback.duration)}>
          <MapPin size={18} /><span>Marker</span>
        </Button>
        {playback.isPreparing ? <span role="status" aria-label="Playback preparation" className="col-span-full text-xs text-muted">再生位置を準備しています。</span> : null}
      </div>

      <label className="track-setting col-span-full flex-wrap text-sm">
        <input type="checkbox" className="library-checkbox" checked={autoNext.enabled}
          onChange={(event) => autoNext.setEnabled(event.target.checked)}
          aria-label="次の曲を自動再生" aria-describedby="auto-next-description playback-keyboard-help" />
        <span>次の曲を自動再生</span>
        <span id="auto-next-description" className="w-full text-xs text-muted">{autoNext.description}</span>
      </label>

      <div className="track-setting col-span-full" aria-label="Playback speed">
        <span className="px-1 text-xs font-medium text-muted lg:hidden">速度</span>
        <Gauge className="hidden text-muted lg:block" size={18} aria-hidden="true" />
        <div className="grid min-w-0 flex-1 grid-cols-4 gap-1 lg:hidden">
          {playbackRates.map((rate) => <Button key={rate} className="min-w-0 px-1 tabular-nums" aria-pressed={playback.playbackRate === rate}
            variant={playback.playbackRate === rate ? "accent" : "secondary"} onClick={() => playback.selectPlaybackRate(rate)}>{rate}x</Button>)}
        </div>
        <IconButton className="hidden lg:inline-flex" title="速度を下げる" onClick={() => playback.changePlaybackRate("slower")}><Minus size={17} /></IconButton>
        <strong className="sr-only min-w-11 text-center tabular-nums text-ink lg:not-sr-only">{playback.playbackRate}x</strong>
        <IconButton className="hidden lg:inline-flex" title="速度を上げる" onClick={() => playback.changePlaybackRate("faster")}><Plus size={17} /></IconButton>
      </div>

      <div className="track-setting flex-wrap justify-between" aria-label="Waveform zoom">
        <span className="w-full px-1 text-xs font-medium text-muted lg:hidden">波形ズーム</span>
        <ZoomOut className="hidden text-muted lg:block" size={18} aria-hidden="true" />
        <IconButton className="max-lg:size-11" title="波形を縮小" disabled={waveform.waveformZoom <= minWaveformZoom}
          onClick={() => waveform.changeWaveformZoom("out")}><ZoomOut size={17} /></IconButton>
        <strong className="min-w-0 flex-1 text-center tabular-nums text-ink">{formatWaveformZoom(waveform.waveformZoom)}</strong>
        <IconButton className="max-lg:size-11" title="波形を拡大" disabled={waveform.waveformZoom >= maxWaveformZoom}
          onClick={() => waveform.changeWaveformZoom("in")}><ZoomIn size={17} /></IconButton>
      </div>

      <div className="track-setting flex-wrap justify-between" aria-label="Transpose">
        <span className="w-full px-1 text-xs font-medium text-muted lg:hidden">キー（半音）</span>
        <Music2 className="hidden text-muted lg:block" size={18} aria-hidden="true" />
        <IconButton className="max-lg:size-11" title="半音下げる" disabled={transpose.semitones <= minTransposeSemitones}
          onClick={() => transpose.changeTranspose("down")}><Minus size={17} /></IconButton>
        <Button className="min-w-11 px-1 tabular-nums" title="転調を0に戻す"
          aria-label={`転調 ${formatTransposeSemitones(transpose.semitones)} 半音。0に戻す`} onClick={transpose.resetTranspose}>
          {formatTransposeSemitones(transpose.semitones)}
        </Button>
        <IconButton className="max-lg:size-11" title="半音上げる" disabled={transpose.semitones >= maxTransposeSemitones}
          onClick={() => transpose.changeTranspose("up")}><Plus size={17} /></IconButton>
      </div>

      <div className="track-setting col-span-full flex-wrap" aria-label="Click track">
        <Button className="min-w-0 flex-1 lg:flex-none" size="transport" variant={clickTrack.isClickEnabled ? "accent" : "secondary"}
          title="クリック音をオン/オフ" aria-pressed={clickTrack.isClickEnabled} disabled={!clickTrack.isClickAvailable || isBeatAnalysisBusy}
          onClick={clickTrack.toggleClickTrack}>
          {clickTrack.isClickEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}<span>Click</span>
        </Button>
        <IconButton className="max-lg:size-11" title="この曲のクリック解析を再実行" disabled={isBeatAnalysisBusy} onClick={onRetryBeatAnalysis}>
          <RefreshCw className={isBeatAnalysisBusy ? "animate-spin" : undefined} size={17} />
        </IconButton>
        <span className={cn("min-w-0 text-xs text-muted", beatGrid ? "max-lg:sr-only" : "w-full lg:w-auto")}>{beatStatus}</span>
      </div>
      <p id="playback-keyboard-help" className="col-span-full text-xs text-muted lg:basis-full">
        Space / Enter / K：再生・停止 · Alt + Enter：フォーカス中の操作を実行
      </p>
    </Surface>
  );
}
