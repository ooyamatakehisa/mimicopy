import { useSearchParams } from "react-router";
import { AppHeader } from "../../components/layout/AppHeader";
import type { LibraryScope } from "../../lib/folders";
import { LibraryHeaderActions } from "./LibraryHeaderActions";
import { LibraryDragDrop } from "./LibraryDragDrop";
import { LibraryPanel } from "./LibraryPanel";
import { FolderSidebar } from "./FolderSidebar";
import { useLibraryState } from "./useLibraryState";
import { useFolders } from "./useFolders";

type LibraryPageProps = {
  activeTrackId: string | null;
  navigateToLibrary: () => void;
  navigateToTrack: (trackId: string) => void;
};

export function LibraryPage({
  activeTrackId,
  navigateToLibrary,
  navigateToTrack
}: LibraryPageProps) {
  const library = useLibraryState({ navigateToTrack });
  const folders = useFolders();
  const [searchParams, setSearchParams] = useSearchParams();
  const folderParam = searchParams.get("folder");
  const scope: LibraryScope = !folderParam
    ? "all"
    : folderParam === "unfiled"
      ? "unfiled"
      : `folder:${folderParam}`;
  const onNavigate = (next: LibraryScope) => {
    setSearchParams((params) => {
      if (next === "all") params.delete("folder");
      else params.set("folder", next === "unfiled" ? "unfiled" : next.slice(7));
      return params;
    });
  };
  return (
    <>
      <AppHeader
        subtitle="曲を整理して、耳コピをもっとスムーズに。"
        actions={
          <LibraryHeaderActions
            convertYoutube={library.convertYoutube}
            isConverting={library.isConverting}
            isUploading={library.isUploading}
            uploadFile={library.uploadFile}
          />
        }
        onNavigateHome={navigateToLibrary}
      />
      <LibraryDragDrop>
        <div className="grid min-h-[calc(100dvh-148px)] min-w-0 overflow-hidden rounded-2xl border border-line bg-surface lg:grid-cols-[260px_minmax(0,1fr)]">
          <FolderSidebar
            scope={scope}
            onNavigate={onNavigate}
            tracks={library.tracks}
            folders={folders}
          />
          <LibraryPanel
            key={scope}
            scope={scope}
            onNavigate={onNavigate}
            library={library}
            folders={folders}
            activeTrackId={activeTrackId}
            navigateToTrack={navigateToTrack}
          />
        </div>
      </LibraryDragDrop>
    </>
  );
}
