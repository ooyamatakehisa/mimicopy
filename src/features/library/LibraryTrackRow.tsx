import { useDraggable } from "@dnd-kit/react";
import { useEffect, useRef, useState } from "react";
import {
  Check,
  FolderInput,
  GripVertical,
  LoaderCircle,
  Pencil,
  Trash2,
  X
} from "lucide-react";
import { IconButton } from "../../components/ui/Button";
import { TextInput } from "../../components/ui/TextInput";
import { cn } from "../../lib/cn";
import { formatTime } from "../../lib/playback";
import type { TrackDragData } from "../../lib/libraryDrag";
import type { TrackSummary } from "../../lib/library";
import { formatLibraryDate } from "./libraryFormatting";

export function LibraryTrackRow({
  activeTrackId,
  dragTrackIds,
  dragDisabled,
  folderName,
  selected,
  onSelect,
  onMove,
  isRenaming,
  navigateToTrack,
  onDelete,
  onRename,
  track
}: {
  activeTrackId: string | null;
  dragTrackIds: string[];
  dragDisabled: boolean;
  folderName: string;
  selected: boolean;
  onSelect: () => void;
  onMove: () => void;
  isRenaming: boolean;
  navigateToTrack: (trackId: string) => void;
  onDelete: () => void;
  onRename: (title: string) => Promise<boolean>;
  track: TrackSummary;
}) {
  const [draftTitle, setDraftTitle] = useState(track.title);
  const [isEditing, setIsEditing] = useState(false);
  const editRef = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (!isEditing && wasEditing.current) editRef.current?.focus();
    wasEditing.current = isEditing;
  }, [isEditing]);
  const isDragDisabled =
    dragDisabled || isEditing || isRenaming || dragTrackIds.length > 500;
  const {
    ref: dragRef,
    handleRef,
    isDragSource
  } = useDraggable<TrackDragData>({
    id: track.id,
    type: "tracks",
    data: { kind: "tracks", trackIds: dragTrackIds, title: track.title },
    disabled: isDragDisabled
  });
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
      ref={dragRef}
      tabIndex={-1}
      aria-label={`${track.title} library track`}
      className={cn(
        "library-track-row group relative lg:cursor-grab focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal",
        isDragSource && "opacity-40",
        (selected || track.id === activeTrackId) && "bg-teal/5"
      )}
      data-testid={`library-track-${track.id}`}
      role="group"
    >
      <input
        type="checkbox"
        className="library-checkbox max-sm:mt-5 max-sm:self-start"
        aria-label={`${track.title} を選択`}
        checked={selected}
        onChange={onSelect}
      />
      <div className="col-span-2 min-w-0 py-3 sm:col-span-1">
        <div className="flex min-w-0 items-center gap-2">
          <button
            ref={handleRef}
            type="button"
            data-drag-handle
            disabled={isDragDisabled}
            className="hidden shrink-0 cursor-grab rounded text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal lg:block"
            title={`${track.title} をドラッグ`}
            aria-roledescription="ドラッグできる曲"
          >
            <GripVertical size={20} aria-hidden="true" />
          </button>
          {isEditing ? (
            <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2">
              <TextInput
                aria-label={`${track.title} display name`}
                autoFocus
                className="h-10 w-full rounded-lg text-sm"
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
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <button
                className="min-w-0 bg-transparent text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue"
                type="button"
                data-track-link
                title={`${track.title} を開く`}
                onClick={() => navigateToTrack(track.id)}
              >
                <strong className="line-clamp-2 break-words text-sm font-medium leading-snug text-ink sm:line-clamp-none sm:block sm:truncate">
                  {track.title}
                </strong>
              </button>
              <IconButton
                className="size-8 border-transparent bg-transparent shadow-none"
                ref={editRef}
                title="表示名を編集"
                onClick={startEditing}
              >
                <Pencil size={14} />
              </IconButton>
            </div>
          )}
        </div>
        <div
          className={cn(
            "mt-1 flex min-w-0 items-center gap-3 text-xs text-muted max-sm:min-h-9 lg:hidden",
            !isEditing && "max-sm:pr-20"
          )}
        >
          <span className="truncate">{folderName}</span>
          <span className="tabular-nums sm:hidden">
            {formatTime(track.duration)}
          </span>
        </div>
      </div>
      <span
        className="hidden truncate text-sm text-muted lg:block"
        title={folderName}
      >
        {folderName}
      </span>
      <span className="hidden text-right text-sm tabular-nums text-muted sm:block">
        {formatTime(track.duration)}
      </span>
      <span className="hidden text-right text-xs tabular-nums text-muted xl:block">
        {formatLibraryDate(track.updatedAt)}
      </span>
      <div
        className={cn(
          "flex items-center justify-end gap-1 max-sm:absolute max-sm:bottom-3 max-sm:right-0",
          isEditing && "hidden sm:flex"
        )}
      >
        <IconButton
          className="size-9 border-transparent bg-transparent shadow-none"
          title="フォルダに移動"
          aria-label={`${track.title} をフォルダに移動`}
          onClick={onMove}
        >
          <FolderInput size={17} />
        </IconButton>
        <IconButton
          className="size-9 border-transparent bg-transparent shadow-none"
          variant="danger"
          title="保存済みMP3を削除"
          onClick={onDelete}
        >
          <Trash2 size={17} />
        </IconButton>
      </div>
    </div>
  );
}
