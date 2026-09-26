import { useEffect, useRef, useState } from "react";
import { FolderPlus } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { LibraryFolderButton } from "./LibraryFolderButton";
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
      count: tracks.length
    },
    {
      scope: "unfiled" as const,
      name: "未分類",
      count: counts.get("unfiled") ?? 0
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
        {entries.map(({ scope: itemScope, name, count }) => (
          <LibraryFolderButton
            key={itemScope}
            scope={itemScope}
            active={scope === itemScope}
            name={name}
            count={count}
            tracks={tracks}
            disabled={folders.moveMutation.isPending}
            onNavigate={onNavigate}
          />
        ))}
        <div className="flex items-center justify-between pb-2 pt-7 text-xs text-muted">
          <span>フォルダ</span>
          <span>{folders.foldersQuery.data?.length ?? 0}</span>
        </div>
        <div className="max-h-48 space-y-1 overflow-y-auto lg:max-h-[48vh]">
          {folders.foldersQuery.data?.map((folder) => (
            <LibraryFolderButton
              key={folder.id}
              scope={`folder:${folder.id}`}
              active={scope === `folder:${folder.id}`}
              name={folder.name}
              count={counts.get(folder.id) ?? 0}
              tracks={tracks}
              disabled={folders.moveMutation.isPending}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      </nav>
      <p className="mt-4 hidden text-xs leading-relaxed text-muted lg:block">
        曲をフォルダにドラッグして移動。複数選択にも対応しています。
      </p>
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
