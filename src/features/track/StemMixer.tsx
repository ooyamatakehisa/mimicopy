import { useId, useState } from "react";
import {
  AudioLines,
  ChevronDown,
  Download,
  LoaderCircle,
  Volume2,
  VolumeX
} from "lucide-react";
import { Button, buttonVariants } from "../../components/ui/Button";
import { getTrackAudioDownloadFilename } from "../../lib/audioDownload";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { cn } from "../../lib/cn";
import type { MixerChannelId } from "../../lib/mixer";
import {
  formatEstimatedRemainingTime,
  stemLabels,
  type TrackSeparation
} from "../../lib/separation";
import type { StemMixerState } from "./useStemMixer";

type StemMixerProps = {
  mixer: StemMixerState;
  mixerReady: boolean;
  preparationMessage: string | null;
  preparationFailed: boolean;
  originalMediaUrl: string;
  separation: TrackSeparation;
  trackTitle: string;
};

export function StemMixer({
  mixer,
  mixerReady,
  preparationMessage,
  preparationFailed,
  originalMediaUrl,
  separation,
  trackTitle
}: StemMixerProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const channelsId = useId();
  const stemReady =
    separation.status === "completed" && Boolean(separation.mediaUrl);
  const remainderReady =
    separation.status === "completed" &&
    Boolean(separation.remainderMediaUrl);

  return (
    <section
      aria-label="Audio mixer"
      className="mx-4 mt-4 grid gap-3 rounded-2xl border border-white/8 bg-black/15 p-3 max-lg:order-2 max-lg:m-0 max-lg:gap-0 max-lg:p-2"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 px-1">
        <div className="hidden min-w-0 items-center gap-2 lg:flex">
          <AudioLines className="shrink-0 text-teal" size={18} />
          <strong className="truncate text-sm text-ink">Audio mixer</strong>
        </div>
        <button
          type="button"
          aria-controls={channelsId}
          aria-expanded={isExpanded}
          className="flex min-h-11 flex-1 items-center gap-2 rounded-xl text-left text-sm font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue lg:hidden"
          onClick={() => setIsExpanded((expanded) => !expanded)}
        >
          <AudioLines aria-hidden="true" className="text-teal" size={18} />
          Audio mixer
          <ChevronDown aria-hidden="true" size={18} className={cn("ml-auto", isExpanded && "rotate-180")} />
        </button>
        <SeparationStatus separation={separation} />
      </div>
      <div id={channelsId} className={cn("grid-cols-3 gap-3 lg:grid max-lg:grid-cols-1 max-lg:pt-2", isExpanded ? "grid" : "hidden")}>
        <MixerChannel
          channelId="original"
          download={{
            filename: getTrackAudioDownloadFilename(
              trackTitle,
              "original",
              separation.targetStem
            ),
            mediaUrl: originalMediaUrl
          }}
          disabled={false}
          label="原音"
          mixer={mixer}
        />
        <MixerChannel
          channelId="stem"
          download={
            stemReady && separation.mediaUrl
              ? {
                  filename: getTrackAudioDownloadFilename(
                    trackTitle,
                    "stem",
                    separation.targetStem
                  ),
                  mediaUrl: separation.mediaUrl
                }
              : null
          }
          disabled={!stemReady || !mixerReady}
          label={stemLabels[separation.targetStem]}
          mixer={mixer}
        />
        <MixerChannel
          channelId="remainder"
          download={
            remainderReady && separation.remainderMediaUrl
              ? {
                  filename: getTrackAudioDownloadFilename(
                    trackTitle,
                    "remainder",
                    separation.targetStem
                  ),
                  mediaUrl: separation.remainderMediaUrl
                }
              : null
          }
          disabled={!remainderReady || !mixerReady}
          label={`${stemLabels[separation.targetStem]}以外`}
          mixer={mixer}
        />
      </div>
      {preparationMessage ? (
        <p role={preparationFailed ? "alert" : "status"}
          className={cn("px-1 text-sm", preparationFailed ? "text-danger" : "text-muted")}>
          {preparationMessage}
        </p>
      ) : null}
      {separation.status === "failed" ? (
        <p className="px-1 text-sm text-danger">
          {separation.error ?? "音源分離に失敗しました。"}
        </p>
      ) : null}
    </section>
  );
}

function SeparationStatus({
  separation
}: {
  separation: TrackSeparation;
}) {
  if (
    separation.status === "queued" ||
    separation.status === "running"
  ) {
    const progress = separation.progress;

    return (
      <div
        aria-label="音源分離の進捗"
        className="grid w-full max-w-72 gap-1.5 text-xs text-muted"
      >
        <span className="flex items-center justify-end gap-2">
          <LoaderCircle className="animate-spin" size={14} />
          {separation.status === "queued"
            ? "分離待ち"
            : progress
              ? `${stemLabels[separation.targetStem]}を分離中 ${progress.percentage}%`
              : `${stemLabels[separation.targetStem]}を分離中`}
        </span>
        {separation.status === "running" && progress ? (
          <>
            <span className="flex items-center justify-between gap-3 tabular-nums">
              <span>
                {progress.completedSegments} / {progress.totalSegments}{" "}
                セグメント完了
              </span>
              <span>
                {formatEstimatedRemainingTime(
                  progress.estimatedRemainingSeconds
                )}
              </span>
            </span>
            <span
              aria-label={`${progress.percentage}%完了`}
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={progress.percentage}
              className="h-1.5 overflow-hidden rounded-full bg-white/10"
              role="progressbar"
            >
              <span
                className="block h-full rounded-full bg-teal transition-[width] duration-500"
                style={{ width: `${progress.percentage}%` }}
              />
            </span>
          </>
        ) : null}
      </div>
    );
  }

  return separation.status === "failed" ? (
    <StatusBadge state="error">分離失敗</StatusBadge>
  ) : null;
}

function MixerChannel({
  channelId,
  disabled,
  download,
  label,
  mixer
}: {
  channelId: MixerChannelId;
  disabled: boolean;
  download: { filename: string; mediaUrl: string } | null;
  label: string;
  mixer: StemMixerState;
}) {
  const channel = mixer.channels[channelId];
  const volumePercent = Math.round(channel.volume * 100);

  return (
    <div
      className={cn(
        "grid min-w-0 grid-cols-[minmax(80px,1fr)_auto_auto_auto_minmax(100px,1.4fr)] items-center gap-2 rounded-2xl border border-white/8 bg-white/[0.045] p-2 max-sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]",
        disabled && "opacity-50"
      )}
      aria-label={`${label} channel`}
    >
      <strong className="min-w-0 truncate px-1 text-sm text-ink">
        {label}
      </strong>
      {download ? (
        <a
          aria-label={`${label}をダウンロード`}
          className={cn(buttonVariants({ size: "sm" }), "size-9 px-0 max-lg:size-11")}
          download={download.filename}
          href={download.mediaUrl}
          title={`${label}をダウンロード`}
        >
          <Download aria-hidden="true" size={15} />
        </a>
      ) : (
        <Button
          aria-label={`${label}は分離完了後にダウンロードできます`}
          className="size-9 px-0 max-lg:size-11"
          disabled
          size="sm"
          title={`${label}は分離完了後にダウンロードできます`}
        >
          <Download aria-hidden="true" size={15} />
        </Button>
      )}
      <Button
        aria-pressed={channel.muted}
        className="min-w-16 max-lg:h-11"
        disabled={disabled}
        size="sm"
        title={`${label}をミュート`}
        variant={channel.muted ? "accent" : "secondary"}
        onClick={() => mixer.toggleMute(channelId)}
      >
        {channel.muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
        M
      </Button>
      <Button
        aria-pressed={channel.solo}
        className="min-w-14 max-lg:h-11"
        disabled={disabled}
        size="sm"
        title={`${label}をソロ`}
        variant={channel.solo ? "accent" : "secondary"}
        onClick={() => mixer.toggleSolo(channelId)}
      >
        S
      </Button>
      <label className="flex min-w-0 items-center gap-2 text-xs text-muted max-sm:col-span-4">
        <span className="sr-only">{label}の音量</span>
        <input
          aria-label={`${label}の音量`}
          className="min-w-0 flex-1 accent-teal max-lg:h-11"
          disabled={disabled}
          max="100"
          min="0"
          type="range"
          value={volumePercent}
          onChange={(event) =>
            mixer.setVolume(channelId, Number(event.target.value) / 100)
          }
        />
        <span className="w-9 text-right tabular-nums">{volumePercent}%</span>
      </label>
    </div>
  );
}
