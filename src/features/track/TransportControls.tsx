import {
  AudioLines,
  Gauge,
  Link,
  MapPin,
  Pause,
  Play,
  RefreshCw,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import { type FormEvent } from "react";
import { Button, IconButton } from "../../components/ui/Button";
import { Surface } from "../../components/ui/Surface";
import type { BeatGrid } from "../../lib/beats";
import type { MarkersState } from "./useMarkersState";
import type { ClickTrackState } from "./useClickTrack";
import type { PlaybackState } from "./usePlaybackState";
import type { WaveformViewportState } from "./useWaveformViewport";

type TransportControlsProps = {
  beatGrid: BeatGrid | null;
  beatGridErrorMessage: string | null;
  beatReferenceTitle: string | null;
  beatReferenceUrl: string;
  clickTrack: ClickTrackState;
  isAnalyzingBeatGrid: boolean;
  isLoadingBeatGrid: boolean;
  markers: MarkersState;
  onAnalyzeBeatGrid: (youtubeUrl: string) => void;
  onBeatReferenceUrlChange: (youtubeUrl: string) => void;
  playback: PlaybackState;
  waveform: WaveformViewportState;
};

export function TransportControls({
  beatGrid,
  beatGridErrorMessage,
  beatReferenceTitle,
  beatReferenceUrl,
  clickTrack,
  isAnalyzingBeatGrid,
  isLoadingBeatGrid,
  markers,
  onAnalyzeBeatGrid,
  onBeatReferenceUrlChange,
  playback,
  waveform
}: TransportControlsProps) {
  const trimmedBeatReferenceUrl = beatReferenceUrl.trim();
  const beatStatus = beatGrid
    ? `${beatGrid.beats.length} beats / ${beatGrid.downbeats.length} downbeats${
        beatReferenceTitle ? ` / ${beatReferenceTitle}` : ""
      }`
    : beatGridErrorMessage || clickTrack.clickErrorMessage || "No beat grid";
  const handleBeatGridSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onAnalyzeBeatGrid(beatReferenceUrl);
  };

  return (
    <Surface
      as="footer"
      className="flex min-h-[76px] flex-wrap items-center justify-between gap-4 rounded-full px-4 py-3 max-xl:rounded-[2rem] max-lg:flex-col max-lg:items-stretch"
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

      <form
        className="flex min-w-[360px] max-w-[680px] flex-1 items-center justify-end gap-2 rounded-full border border-white/8 bg-white/[0.04] p-1 max-lg:w-full max-lg:min-w-0 max-lg:justify-start max-sm:flex-wrap max-sm:rounded-[1.5rem]"
        aria-label="Click track"
        onSubmit={handleBeatGridSubmit}
      >
        <AudioLines className="text-muted" size={18} aria-hidden="true" />
        <label className="sr-only" htmlFor="click-source-url">
          Click source YouTube URL
        </label>
        <div className="flex h-11 min-w-48 flex-1 items-center gap-2 rounded-full border border-white/8 bg-black/10 px-3 focus-within:border-teal/55 max-sm:min-w-full">
          <Link className="shrink-0 text-muted" size={16} aria-hidden="true" />
          <input
            id="click-source-url"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-quiet"
            type="url"
            inputMode="url"
            placeholder="https://www.youtube.com/watch?v=..."
            value={beatReferenceUrl}
            onChange={(event) => onBeatReferenceUrlChange(event.target.value)}
          />
        </div>
        <IconButton
          type="submit"
          title="クリック用YouTubeを解析"
          disabled={
            isAnalyzingBeatGrid || isLoadingBeatGrid || !trimmedBeatReferenceUrl
          }
        >
          <RefreshCw
            className={isAnalyzingBeatGrid ? "animate-spin" : undefined}
            size={17}
          />
        </IconButton>
        <Button
          className="min-w-24"
          size="transport"
          variant={clickTrack.isClickEnabled ? "accent" : "secondary"}
          title="クリック音をオン/オフ"
          aria-pressed={clickTrack.isClickEnabled}
          disabled={!beatGrid || isAnalyzingBeatGrid || isLoadingBeatGrid}
          onClick={clickTrack.toggleClickTrack}
        >
          {clickTrack.isClickEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
          <span>Click</span>
        </Button>
        <strong className="min-w-32 max-w-48 truncate text-center text-xs font-semibold text-muted">
          {isAnalyzingBeatGrid
            ? "Analyzing..."
            : isLoadingBeatGrid
              ? "Loading..."
              : beatStatus}
        </strong>
      </form>

      <div
        className="flex min-w-44 items-center justify-end gap-2 rounded-full border border-white/8 bg-white/[0.04] p-1 max-lg:w-full max-lg:justify-start"
        aria-label="Waveform zoom"
      >
        <ZoomOut className="text-muted" size={18} aria-hidden="true" />
        <IconButton
          title="波形を縮小"
          disabled={waveform.waveformZoom === 1}
          onClick={() => waveform.changeWaveformZoom("out")}
        >
          <ZoomOut size={17} />
        </IconButton>
        <strong className="min-w-11 text-center tabular-nums text-ink">
          {waveform.waveformZoom}x
        </strong>
        <IconButton
          title="波形を拡大"
          disabled={waveform.waveformZoom === 16}
          onClick={() => waveform.changeWaveformZoom("in")}
        >
          <ZoomIn size={17} />
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
