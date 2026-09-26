import { useEffect, useRef, useState } from "react";
import {
  FolderInput,
  FolderOpen,
  Music2,
  RefreshCcw,
  Search,
  X
} from "lucide-react";
import { Button, IconButton } from "../../components/ui/Button";
import { TextInput } from "../../components/ui/TextInput";
import { filterLibraryTracks, type LibraryScope } from "../../lib/folders";
import type { LibraryState } from "./useLibraryState";
import type { FoldersState } from "./useFolders";
import { FolderActions } from "./FolderActions";
import { LibraryTrackRow } from "./LibraryTrackRow";
import { MoveTracksForm } from "./MoveTracksForm";

type LibraryPanelProps = {
  activeTrackId: string | null;
  navigateToTrack: (trackId: string) => void;
  scope: LibraryScope;
  onNavigate: (scope: LibraryScope) => void;
  library: LibraryState;
  folders: FoldersState;
};

export function LibraryPanel({
  activeTrackId,
  navigateToTrack,
  scope,
  onNavigate,
  library,
  folders
}: LibraryPanelProps) {
  const [search, setSearch] = useState("");
  const [selection, setSelection] = useState<string[]>([]);
  const [movingIds, setMovingIds] = useState<string[] | null>(null);
  const [moveNotice, setMoveNotice] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const moveTrigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (movingIds === null && moveTrigger.current) {
      if (moveTrigger.current.isConnected) moveTrigger.current.focus();
      else headingRef.current?.focus();
      moveTrigger.current = null;
    }
  }, [movingIds]);
  const folder = folders.foldersQuery.data?.find(
    (item) => scope === `folder:${item.id}`
  );
  const missingFolder =
    scope.startsWith("folder:") && folders.foldersQuery.isSuccess && !folder;
  const title =
    scope === "all"
      ? "すべての曲"
      : scope === "unfiled"
        ? "未分類"
        : (folder?.name ?? "フォルダ");
  const scopedTracks = filterLibraryTracks(library.tracks, scope, "");
  const visibleTracks = filterLibraryTracks(scopedTracks, "all", search);
  const selectedIds = visibleTracks
    .filter((track) => selection.includes(track.id))
    .map((track) => track.id);
  const allSelected =
    visibleTracks.length > 0 && selectedIds.length === visibleTracks.length;
  const isLoading = library.isLibraryLoading || folders.foldersQuery.isFetching;
  const beginMove = (ids: string[]) => {
    moveTrigger.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    folders.moveMutation.reset();
    setMoveNotice("");
    setMovingIds(ids);
  };
  const finishMove = (didMove: boolean) => {
    if (didMove) {
      setMoveNotice(`${movingIds?.length ?? 0} 曲を移動しました。`);
      setSelection([]);
    }
    setMovingIds(null);
  };
  return (
    <section
      className="min-w-0 bg-surface"
      aria-label="Saved MP3 library"
      aria-busy={isLoading}
    >
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 pb-5 pt-7 sm:px-7">
        <div className="min-w-0 flex-1">
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="break-words text-2xl font-semibold tracking-tight outline-none"
          >
            {title}
          </h2>
          <p className="mt-2 text-sm text-muted">
            {scopedTracks.length} 曲
            {scope === "unfiled" && " · まだフォルダに入っていない曲"}
          </p>
        </div>
        <IconButton
          title="一覧を更新"
          disabled={isLoading}
          onClick={() => {
            void folders.refresh();
          }}
        >
          <RefreshCcw
            size={17}
            className={isLoading ? "animate-spin" : undefined}
          />
        </IconButton>
        {folder && (
          <div className="w-full">
            <FolderActions
              key={folder.id}
              folder={folder}
              folders={folders}
              onDeleted={() => onNavigate("unfiled")}
            />
          </div>
        )}
      </div>
      <div className="relative mx-5 mb-5 sm:mx-7">
        <Search
          className="pointer-events-none absolute left-3 top-3 text-muted"
          size={18}
          aria-hidden="true"
        />
        <TextInput
          type="search"
          aria-label="曲を検索"
          placeholder="曲名で検索"
          className="w-full rounded-lg pl-10 placeholder:text-muted"
          value={search}
          disabled={Boolean(movingIds)}
          onChange={(event) => {
            setSearch(event.target.value);
            setSelection([]);
          }}
        />
      </div>
      {library.loadState !== "idle" && (
        <p
          className={`px-5 pb-4 text-sm sm:px-7 ${library.loadState === "error" ? "text-danger" : "text-muted"}`}
          role={library.loadState === "error" ? "alert" : "status"}
        >
          {library.message}
        </p>
      )}
      {moveNotice && (
        <p role="status" className="px-5 pb-4 text-sm text-teal sm:px-7">
          {moveNotice}
        </p>
      )}
      {missingFolder ? (
        <div className="px-7 py-16 text-center">
          <h3 className="font-medium">このフォルダは見つかりません</h3>
          <p className="mt-2 text-sm text-muted">
            削除された可能性があります。すべての曲から探してください。
          </p>
          <Button className="mt-5" onClick={() => onNavigate("all")}>
            すべての曲を表示
          </Button>
        </div>
      ) : (
        <>
          {movingIds ? (
            <MoveTracksForm
              trackIds={movingIds}
              folders={folders}
              onDone={() => finishMove(true)}
              onCancel={() => finishMove(false)}
            />
          ) : (
            selectedIds.length > 0 && (
              <div className="flex flex-wrap items-center gap-3 border-y border-line bg-surface-muted px-5 py-3 sm:px-7">
                <span className="text-sm tabular-nums">
                  {selectedIds.length} 曲を選択中
                </span>
                <Button
                  size="sm"
                  variant="accent"
                  onClick={() => beginMove(selectedIds)}
                >
                  <FolderInput size={16} />
                  選択した曲を移動
                </Button>
                <IconButton
                  title="選択を解除"
                  className="ml-auto size-9"
                  onClick={() => setSelection([])}
                >
                  <X size={16} />
                </IconButton>
              </div>
            )
          )}
          {visibleTracks.length > 0 ? (
            <div className="px-5 sm:px-7">
              <div className="library-track-row border-b border-line py-3 text-xs text-muted">
                <input
                  type="checkbox"
                  className="library-checkbox"
                  aria-label="表示中の曲をすべて選択"
                  checked={allSelected}
                  disabled={Boolean(movingIds)}
                  ref={(input) => {
                    if (input)
                      input.indeterminate =
                        selectedIds.length > 0 && !allSelected;
                  }}
                  onChange={() =>
                    setSelection(
                      allSelected ? [] : visibleTracks.map((track) => track.id)
                    )
                  }
                />
                <span>曲名</span>
                <span className="hidden lg:block">フォルダ</span>
                <span className="hidden text-right sm:block">時間</span>
                <span className="hidden text-right xl:block">更新日</span>
                <span className="text-right">操作</span>
              </div>
              <div
                className={
                  movingIds ? "pointer-events-none opacity-50" : undefined
                }
                inert={Boolean(movingIds)}
              >
                {visibleTracks.map((track) => (
                  <LibraryTrackRow
                    key={track.id}
                    activeTrackId={activeTrackId}
                    track={track}
                    folderName={
                      folders.foldersQuery.data?.find(
                        (item) => item.id === track.folderId
                      )?.name ?? "未分類"
                    }
                    selected={selectedIds.includes(track.id)}
                    onSelect={() =>
                      setSelection((ids) =>
                        ids.includes(track.id)
                          ? ids.filter((id) => id !== track.id)
                          : [...ids, track.id]
                      )
                    }
                    onMove={() => beginMove([track.id])}
                    navigateToTrack={navigateToTrack}
                    onDelete={() =>
                      void library.deleteTrackFromLibrary(track.id)
                    }
                    onRename={(trackTitle) =>
                      library.renameTrackInLibrary({
                        title: trackTitle,
                        trackId: track.id
                      })
                    }
                    isRenaming={library.isRenamingTrackId === track.id}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="flex min-h-72 flex-col items-center justify-center gap-3 px-6 py-14 text-center">
              {isLoading ? (
                <p className="text-sm text-muted" role="status">
                  曲を読み込み中…
                </p>
              ) : (
                <>
                  {scope.startsWith("folder:") ? (
                    <FolderOpen
                      size={32}
                      strokeWidth={1.25}
                      className="mb-2 text-muted"
                    />
                  ) : (
                    <Music2
                      size={32}
                      strokeWidth={1.25}
                      className="mb-2 text-muted"
                    />
                  )}
                  <h3 className="font-medium">
                    {search
                      ? "一致する曲がありません"
                      : scope === "all"
                        ? "最初の1曲を読み込もう"
                        : scope === "unfiled"
                          ? "未分類の曲はありません"
                          : "このフォルダはまだ空です"}
                  </h3>
                  <p className="max-w-md text-sm leading-relaxed text-muted">
                    {search
                      ? "別の曲名で検索するか、検索を解除してください。"
                      : scope === "all"
                        ? "上のMP3ボタン、またはYouTube URLから曲を追加できます。"
                        : scope === "unfiled"
                          ? "新しく読み込んだ曲は、ここに表示されます。"
                          : "「すべての曲」で曲を選び、このフォルダへ移動できます。"}
                  </p>
                  {search ? (
                    <Button className="mt-2" onClick={() => setSearch("")}>
                      検索を解除
                    </Button>
                  ) : (
                    scope !== "all" && (
                      <Button
                        className="mt-2"
                        onClick={() => onNavigate("all")}
                      >
                        すべての曲から探す
                      </Button>
                    )
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
