import {
  Gauge,
  MapPin,
  Pause,
  Play,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import { Button, IconButton } from "../../components/ui/Button";
import { Surface } from "../../components/ui/Surface";
import type { MarkersState } from "./useMarkersState";
import type { PlaybackState } from "./usePlaybackState";
import type { WaveformViewportState } from "./useWaveformViewport";

type TransportControlsProps = {
  markers: MarkersState;
  playback: PlaybackState;
  waveform: WaveformViewportState;
};

export function TransportControls({
  markers,
  playback,
  waveform
}: TransportControlsProps) {
  return (
    <Surface
      as="footer"
      className="flex min-h-[76px] items-center justify-between gap-4 rounded-full px-4 py-3 max-xl:rounded-[2rem] max-lg:flex-col max-lg:items-stretch"
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
