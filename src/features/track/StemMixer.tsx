import { AudioLines, LoaderCircle, Volume2, VolumeX } from "lucide-react";
import { Button } from "../../components/ui/Button";
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
  separation: TrackSeparation;
};

export function StemMixer({ mixer, separation }: StemMixerProps) {
  const stemReady =
    separation.status === "completed" && Boolean(separation.mediaUrl);
  const remainderReady =
    separation.status === "completed" &&
    Boolean(separation.remainderMediaUrl);

  return (
    <section
      aria-label="Audio mixer"
      className="mx-4 mt-4 grid gap-3 rounded-[1.75rem] border border-white/8 bg-black/15 p-3"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 px-1">
        <div className="flex min-w-0 items-center gap-2">
          <AudioLines className="shrink-0 text-teal" size={18} />
          <strong className="truncate text-sm text-ink">Audio mixer</strong>
        </div>
        <SeparationStatus separation={separation} />
      </div>
      <div className="grid grid-cols-3 gap-3 max-lg:grid-cols-1">
        <MixerChannel
          channelId="original"
          disabled={false}
          label="原音"
          mixer={mixer}
        />
        <MixerChannel
          channelId="stem"
          disabled={!stemReady}
          label={stemLabels[separation.targetStem]}
          mixer={mixer}
        />
        <MixerChannel
          channelId="remainder"
          disabled={!remainderReady}
          label={`${stemLabels[separation.targetStem]}以外`}
          mixer={mixer}
        />
      </div>
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

  return (
    <StatusBadge
      state={separation.status === "completed" ? "ready" : "error"}
    >
      {separation.status}
    </StatusBadge>
  );
}

function MixerChannel({
  channelId,
  disabled,
  label,
  mixer
}: {
  channelId: MixerChannelId;
  disabled: boolean;
  label: string;
  mixer: StemMixerState;
}) {
  const channel = mixer.channels[channelId];
  const volumePercent = Math.round(channel.volume * 100);

  return (
    <div
      className={cn(
        "grid min-w-0 grid-cols-[minmax(80px,1fr)_auto_auto_minmax(100px,1.4fr)] items-center gap-2 rounded-2xl border border-white/8 bg-white/[0.045] p-2 max-sm:grid-cols-[minmax(80px,1fr)_auto_auto]",
        disabled && "opacity-50"
      )}
      aria-label={`${label} channel`}
    >
      <strong className="min-w-0 truncate px-1 text-sm text-ink">
        {label}
      </strong>
      <Button
        aria-pressed={channel.muted}
        className="min-w-16"
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
        className="min-w-14"
        disabled={disabled}
        size="sm"
        title={`${label}をソロ`}
        variant={channel.solo ? "accent" : "secondary"}
        onClick={() => mixer.toggleSolo(channelId)}
      >
        S
      </Button>
      <label className="flex min-w-0 items-center gap-2 text-xs text-muted max-sm:col-span-3">
        <span className="sr-only">{label}の音量</span>
        <input
          aria-label={`${label}の音量`}
          className="min-w-0 flex-1 accent-teal"
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
