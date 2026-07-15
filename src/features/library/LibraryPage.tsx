import { AppHeader } from "../../components/layout/AppHeader";
import { LibraryHeaderActions } from "./LibraryHeaderActions";
import { LibraryPanel } from "./LibraryPanel";
import { useLibraryState } from "./useLibraryState";

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

  return (
    <>
      <AppHeader
        subtitle="保存済みMP3ライブラリ"
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
      <LibraryPanel
        activeTrackId={activeTrackId}
        deleteTrackFromLibrary={library.deleteTrackFromLibrary}
        isLibraryLoading={library.isLibraryLoading}
        loadState={library.loadState}
        message={library.message}
        navigateToTrack={navigateToTrack}
        refreshTracks={library.refreshTracks}
        tracks={library.tracks}
      />
    </>
  );
}
