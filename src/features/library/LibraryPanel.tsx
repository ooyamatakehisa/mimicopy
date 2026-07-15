import { ListMusic, LoaderCircle, Music2, RefreshCcw, Trash2 } from "lucide-react";
import { IconButton } from "../../components/ui/Button";
import { SectionHeader, Surface } from "../../components/ui/Surface";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { cn } from "../../lib/cn";
import { formatTime } from "../../lib/playback";
import type { TrackSummary } from "../../lib/library";
import type { LibraryState } from "./useLibraryState";
import { formatLibraryDate, getSourceTypeLabel } from "./libraryFormatting";

type LibraryPanelProps = Pick<
  LibraryState,
  | "deleteTrackFromLibrary"
  | "isLibraryLoading"
  | "loadState"
  | "message"
  | "refreshTracks"
  | "tracks"
> & {
  activeTrackId: string | null;
  navigateToTrack: (trackId: string) => void;
};

export function LibraryPanel({
  activeTrackId,
  deleteTrackFromLibrary,
  isLibraryLoading,
  loadState,
  message,
  navigateToTrack,
  refreshTracks,
  tracks
}: LibraryPanelProps) {
  return (
    <Surface
      className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden rounded-[2.25rem]"
      aria-label="Saved MP3 library"
    >
      <SectionHeader
        title="Library"
        description={`${tracks.length} saved MP3s`}
        action={
          <IconButton
            title="一覧を更新"
            disabled={isLibraryLoading}
            onClick={refreshTracks}
          >
            {isLibraryLoading ? (
              <LoaderCircle className="animate-spin" size={18} />
            ) : (
              <RefreshCcw size={18} />
            )}
          </IconButton>
        }
      />

      <div className="mx-4 mb-1 mt-4 grid min-h-14 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-full border border-white/8 bg-white/[0.045] px-3 text-sm text-muted max-sm:grid-cols-1 max-sm:items-start max-sm:rounded-3xl max-sm:px-3 max-sm:py-3">
        <StatusBadge state={loadState}>{loadState}</StatusBadge>
        <span className="min-w-0 truncate">{message}</span>
      </div>

      <div className="min-h-0 overflow-auto p-4">
        {tracks.length === 0 ? (
          <LibraryEmptyState isLoading={isLibraryLoading} />
        ) : (
          tracks.map((track) => (
            <LibraryTrackRow
              key={track.id}
              activeTrackId={activeTrackId}
              navigateToTrack={navigateToTrack}
              track={track}
              onDelete={() => void deleteTrackFromLibrary(track.id)}
            />
          ))
        )}
      </div>
    </Surface>
  );
}

function LibraryEmptyState({ isLoading }: { isLoading: boolean }) {
  return (
    <div className="grid min-h-[360px] place-items-center content-center gap-4 rounded-[2rem] border border-dashed border-white/14 bg-[radial-gradient(circle_at_50%_0%,rgba(67,224,202,0.12),transparent_36%),rgba(255,255,255,0.035)] text-center text-quiet">
      <span className="grid size-16 place-items-center rounded-full border border-white/10 bg-white/[0.06] text-teal">
        <ListMusic size={24} aria-hidden="true" />
      </span>
      <span className="text-sm">
        {isLoading ? "読み込み中" : "保存済みMP3はまだありません"}
      </span>
    </div>
  );
}

function LibraryTrackRow({
  activeTrackId,
  navigateToTrack,
  onDelete,
  track
}: {
  activeTrackId: string | null;
  navigateToTrack: (trackId: string) => void;
  onDelete: () => void;
  track: TrackSummary;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] items-stretch overflow-hidden rounded-[1.75rem] border border-white/8 bg-white/[0.055] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition-[background,border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-white/16 hover:bg-white/[0.075] hover:shadow-tight [&+&]:mt-3",
        track.id === activeTrackId &&
          "border-teal/45 bg-teal/12 shadow-[0_18px_44px_rgba(67,224,202,0.1)]"
      )}
    >
      <button
        className="grid min-w-0 grid-cols-[44px_minmax(220px,1fr)_96px_90px_112px_148px] items-center gap-3 bg-transparent px-4 py-4 text-left text-sm text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue max-[1040px]:grid-cols-[44px_minmax(180px,1fr)_90px_86px_108px] max-[1040px]:[&>span:nth-of-type(6)]:hidden max-lg:grid-cols-[44px_minmax(0,1fr)] max-lg:[&>span:nth-of-type(n+3)]:hidden"
        type="button"
        title={`${track.title} を開く`}
        onClick={() => navigateToTrack(track.id)}
      >
        <span className="grid size-11 place-items-center rounded-2xl bg-teal/12 text-teal">
          <Music2 size={18} aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <strong className="block truncate text-base font-semibold leading-tight text-ink">
            {track.title}
          </strong>
        </span>
        <span className="truncate">{getSourceTypeLabel(track.sourceType)}</span>
        <span className="truncate">{formatTime(track.duration)}</span>
        <span className="truncate">{track.markerCount} markers</span>
        <span className="truncate">
          Updated {formatLibraryDate(track.updatedAt)}
        </span>
      </button>
      <IconButton
        className="m-2 self-center"
        variant="danger"
        title="保存済みMP3を削除"
        onClick={onDelete}
      >
        <Trash2 size={17} />
      </IconButton>
    </div>
  );
}
