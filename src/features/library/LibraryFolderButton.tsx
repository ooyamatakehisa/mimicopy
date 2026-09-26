import { useDragOperation, useDroppable } from "@dnd-kit/react";
import { Folder, FolderInput, FolderOpen, Inbox, Library } from "lucide-react";
import { cn } from "../../lib/cn";
import type { LibraryScope } from "../../lib/folders";
import type { TrackSummary } from "../../lib/library";
import { getTrackMove, type FolderDropData } from "../../lib/libraryDrag";

export function LibraryFolderButton({
  scope,
  active,
  name,
  count,
  tracks,
  disabled,
  onNavigate
}: {
  scope: LibraryScope;
  active: boolean;
  name: string;
  count: number;
  tracks: TrackSummary[];
  disabled: boolean;
  onNavigate: (scope: LibraryScope) => void;
}) {
  const { source } = useDragOperation();
  const data: FolderDropData = {
    kind: "folder",
    folderId: scope.startsWith("folder:") ? scope.slice(7) : null,
    name
  };
  const { ref, isDropTarget } = useDroppable({
    id: scope,
    data,
    disabled: disabled || scope === "all",
    accept: (draggable) => Boolean(getTrackMove(draggable.data, data, tracks))
  });
  const eligible =
    source &&
    scope !== "all" &&
    !disabled &&
    Boolean(getTrackMove(source.data, data, tracks));
  const Icon =
    scope === "all"
      ? Library
      : scope === "unfiled"
        ? Inbox
        : active
          ? FolderOpen
          : Folder;
  return (
    <button
      ref={ref}
      type="button"
      title={name}
      aria-current={active ? "page" : undefined}
      data-drop-active={isDropTarget || undefined}
      className={cn(
        "library-nav",
        active && "library-nav-active",
        eligible && "ring-1 ring-inset ring-teal/35",
        isDropTarget &&
          "bg-teal/20 text-teal ring-2 ring-inset ring-teal hover:bg-teal/20"
      )}
      onClick={() => onNavigate(scope)}
    >
      {isDropTarget ? (
        <FolderInput size={18} aria-hidden="true" />
      ) : (
        <Icon size={18} aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1 truncate text-left">{name}</span>
      <span className="text-xs tabular-nums">
        {isDropTarget ? "ここに移動" : count}
      </span>
    </button>
  );
}
