import { useEffect, useRef, useState } from "react";
import { Folder, FolderOpen, FolderPlus, Inbox, Library } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { cn } from "../../lib/cn";
import type { LibraryScope } from "../../lib/folders";
import type { TrackSummary } from "../../lib/library";
import { FolderNameForm } from "./FolderNameForm";
import type { FoldersState } from "./useFolders";

export function FolderSidebar({
  scope,
  onNavigate,
  tracks,
  folders
}: {
  scope: LibraryScope;
  onNavigate: (scope: LibraryScope) => void;
  tracks: TrackSummary[];
  folders: FoldersState;
}) {
  const [isCreating, setIsCreating] = useState(false);
  const createRef = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (!isCreating && wasEditing.current) createRef.current?.focus();
    wasEditing.current = isCreating;
  }, [isCreating]);
  const counts = new Map<string, number>();
  for (const track of tracks) {
    const key = track.folderId ?? "unfiled";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const finishEditing = () => {
    setIsCreating(false);
  };
  const entries = [
    {
      scope: "all" as const,
      name: "すべての曲",
      count: tracks.length,
      icon: Library
    },
    {
      scope: "unfiled" as const,
      name: "未分類",
      count: counts.get("unfiled") ?? 0,
      icon: Inbox
    }
  ];
  return (
    <aside className="min-w-0 border-b border-line bg-surface-soft p-5 lg:border-b-0 lg:border-r">
      <div className="mb-6 flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Library</h2>
        <span className="text-xs tabular-nums text-muted">
          {tracks.length} 曲
        </span>
      </div>
      <div className="lg:hidden">
        <label
          className="mb-2 block text-xs text-muted"
          htmlFor="mobile-library-folder"
        >
          表示するフォルダ
        </label>
        <select
          id="mobile-library-folder"
          className="library-select w-full"
          value={scope}
          onChange={(event) => onNavigate(event.target.value as LibraryScope)}
        >
          <option value="all">すべての曲 · {tracks.length}</option>
          <option value="unfiled">未分類 · {counts.get("unfiled") ?? 0}</option>
          <optgroup label="フォルダ">
            {folders.foldersQuery.data?.map((folder) => (
              <option key={folder.id} value={`folder:${folder.id}`}>
                {folder.name} · {counts.get(folder.id) ?? 0}
              </option>
            ))}
          </optgroup>
        </select>
      </div>
      <nav
        aria-label="ライブラリのフォルダ"
        className="hidden space-y-1 lg:block"
      >
        {entries.map(({ scope: itemScope, name, count, icon: Icon }) => (
          <button
            key={itemScope}
            type="button"
            aria-current={scope === itemScope ? "page" : undefined}
            className={cn(
              "library-nav",
              scope === itemScope && "library-nav-active"
            )}
            onClick={() => onNavigate(itemScope)}
          >
            <Icon size={18} aria-hidden="true" />
            <span className="flex-1 text-left">{name}</span>
            <span className="text-xs tabular-nums">{count}</span>
          </button>
        ))}
        <div className="flex items-center justify-between pb-2 pt-7 text-xs text-muted">
          <span>フォルダ</span>
          <span>{folders.foldersQuery.data?.length ?? 0}</span>
        </div>
        <div className="max-h-48 space-y-1 overflow-y-auto lg:max-h-[48vh]">
          {folders.foldersQuery.data?.map((folder) => {
            const active = scope === `folder:${folder.id}`;
            const Icon = active ? FolderOpen : Folder;
            return (
              <button
                key={folder.id}
                type="button"
                title={folder.name}
                aria-current={active ? "page" : undefined}
                className={cn("library-nav", active && "library-nav-active")}
                onClick={() => onNavigate(`folder:${folder.id}`)}
              >
                <Icon size={18} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-left">
                  {folder.name}
                </span>
                <span className="text-xs tabular-nums">
                  {counts.get(folder.id) ?? 0}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
      {folders.foldersQuery.isPending && (
        <p className="py-3 text-sm text-muted" role="status">
          フォルダを読み込み中…
        </p>
      )}
      {folders.foldersQuery.error && (
        <p className="py-3 text-sm text-danger" role="alert">
          {folders.foldersQuery.error.message}
        </p>
      )}
      <div className="mt-3">
        {isCreating ? (
          <FolderNameForm
            mutation={folders.saveMutation}
            onCancel={finishEditing}
            onDone={(id) => {
              finishEditing();
              onNavigate(`folder:${id}`);
            }}
          />
        ) : (
          <Button
            ref={createRef}
            className="w-full justify-start rounded-lg border-dashed bg-transparent text-muted shadow-none"
            disabled={folders.saveMutation.isPending}
            onClick={() => {
              folders.saveMutation.reset();
              setIsCreating(true);
            }}
          >
            <FolderPlus size={17} aria-hidden="true" />
            新しいフォルダ
          </Button>
        )}
      </div>
      {!isCreating &&
        !folders.foldersQuery.isPending &&
        folders.foldersQuery.data?.length === 0 && (
          <p className="mt-3 text-xs leading-relaxed text-muted">
            アーティストや練習テーマごとに、曲をまとめられます。
          </p>
        )}
    </aside>
  );
}
