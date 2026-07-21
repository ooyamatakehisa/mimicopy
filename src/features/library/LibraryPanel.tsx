import { useState } from "react";
import {
  Check,
  ListMusic,
  LoaderCircle,
  Music2,
  Pencil,
  RefreshCcw,
  Trash2,
  X
} from "lucide-react";
import { IconButton } from "../../components/ui/Button";
import { SectionHeader, Surface } from "../../components/ui/Surface";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { TextInput } from "../../components/ui/TextInput";
import { cn } from "../../lib/cn";
import { formatTime } from "../../lib/playback";
import type { TrackSummary } from "../../lib/library";
import type { LibraryState } from "./useLibraryState";
import { formatLibraryDate, getSourceTypeLabel } from "./libraryFormatting";

type LibraryPanelProps = Pick<
  LibraryState,
  | "deleteTrackFromLibrary"
  | "isLibraryLoading"
  | "isRenamingTrackId"
  | "loadState"
  | "message"
  | "renameTrackInLibrary"
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
  isRenamingTrackId,
  loadState,
  message,
  navigateToTrack,
  renameTrackInLibrary,
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
              onRename={(title) =>
                renameTrackInLibrary({ title, trackId: track.id })
              }
              isRenaming={isRenamingTrackId === track.id}
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
  isRenaming,
  navigateToTrack,
  onDelete,
  onRename,
  track
}: {
  activeTrackId: string | null;
  isRenaming: boolean;
  navigateToTrack: (trackId: string) => void;
  onDelete: () => void;
  onRename: (title: string) => Promise<boolean>;
  track: TrackSummary;
}) {
  const [draftTitle, setDraftTitle] = useState(track.title);
  const [isEditing, setIsEditing] = useState(false);
  const trimmedTitle = draftTitle.trim();

  const startEditing = () => {
    setDraftTitle(track.title);
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setDraftTitle(track.title);
    setIsEditing(false);
  };

  const saveTitle = async () => {
    if (!trimmedTitle) {
      return;
    }

    if (trimmedTitle === track.title) {
      setDraftTitle(track.title);
      setIsEditing(false);
      return;
    }

    if (await onRename(trimmedTitle)) {
      setDraftTitle(trimmedTitle);
      setIsEditing(false);
    }
  };

  return (
    <div
      aria-label={`${track.title} library track`}
      className={cn(
        "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center overflow-hidden rounded-[1.75rem] border border-white/8 bg-white/[0.055] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition-[background,border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-white/16 hover:bg-white/[0.075] hover:shadow-tight [&+&]:mt-3",
        track.id === activeTrackId &&
          "border-teal/45 bg-teal/12 shadow-[0_18px_44px_rgba(67,224,202,0.1)]"
      )}
      data-testid={`library-track-${track.id}`}
      role="group"
    >
      <IconButton
        className="m-2"
        aria-label={`${track.title} を開く`}
        title="曲を開く"
        onClick={() => navigateToTrack(track.id)}
      >
        <Music2 size={18} aria-hidden="true" />
      </IconButton>
      <div className="grid min-w-0 grid-cols-[minmax(220px,1fr)_96px_90px_112px_148px] items-center gap-3 px-2 py-4 text-left text-sm text-muted max-[1040px]:grid-cols-[minmax(180px,1fr)_90px_86px_108px] max-lg:grid-cols-[minmax(0,1fr)]">
        {isEditing ? (
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2">
            <TextInput
              aria-label={`${track.title} display name`}
              autoFocus
              className="h-10 rounded-2xl text-base font-semibold"
              disabled={isRenaming}
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
              disabled={!trimmedTitle || isRenaming}
              title="表示名を保存"
              onClick={() => void saveTitle()}
            >
              {isRenaming ? (
                <LoaderCircle className="animate-spin" size={16} />
              ) : (
                <Check size={16} />
              )}
            </IconButton>
            <IconButton
              className="size-10"
              disabled={isRenaming}
              title="表示名の編集をキャンセル"
              onClick={cancelEditing}
            >
              <X size={16} />
            </IconButton>
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <button
              className="min-w-0 bg-transparent text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue"
              type="button"
              title={`${track.title} を開く`}
              onClick={() => navigateToTrack(track.id)}
            >
              <strong className="block truncate text-base font-semibold leading-tight text-ink">
                {track.title}
              </strong>
            </button>
            <IconButton
              className="size-8"
              title="表示名を編集"
              onClick={startEditing}
            >
              <Pencil size={14} />
            </IconButton>
          </div>
        )}
        <span className="truncate max-lg:hidden">
          {getSourceTypeLabel(track.sourceType)}
        </span>
        <span className="truncate max-lg:hidden">{formatTime(track.duration)}</span>
        <span className="truncate max-lg:hidden">{track.markerCount} markers</span>
        <span className="truncate max-[1040px]:hidden">
          Updated {formatLibraryDate(track.updatedAt)}
        </span>
      </div>
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
