import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  convertYoutubeUrl,
  deleteTrack,
  fetchTracks,
  tracksQueryKey,
  uploadTrack
} from "../../lib/api";
import type { LoadState } from "../../lib/loadState";
import { cacheTrack, removeCachedTrack } from "../../lib/trackQueryCache";

type LibraryNotice = {
  loadState: LoadState;
  message: string;
};

const initialNotice: LibraryNotice = {
  loadState: "idle",
  message: "MP3かYouTube URLを読み込んでください。"
};

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function useLibraryState({
  navigateToTrack
}: {
  navigateToTrack: (trackId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<LibraryNotice>(initialNotice);
  const tracksQuery = useQuery({
    queryFn: fetchTracks,
    queryKey: tracksQueryKey
  });
  const uploadMutation = useMutation({ mutationFn: uploadTrack });
  const youtubeMutation = useMutation({ mutationFn: convertYoutubeUrl });
  const deleteMutation = useMutation({ mutationFn: deleteTrack });

  const uploadFile = useCallback(
    async (file: File) => {
      setNotice({
        loadState: "loading",
        message: `${file.name} を保存しています。`
      });

      try {
        const track = await uploadMutation.mutateAsync(file);

        cacheTrack(queryClient, track);
        setNotice({
          loadState: "ready",
          message: `${track.title} を読み込みました。`
        });
        navigateToTrack(track.id);

        return true;
      } catch (error) {
        setNotice({
          loadState: "error",
          message: getErrorMessage(error, "MP3の保存に失敗しました。")
        });

        return false;
      }
    },
    [navigateToTrack, queryClient, uploadMutation]
  );

  const convertYoutube = useCallback(
    async (url: string) => {
      const trimmedUrl = url.trim();

      if (!trimmedUrl) {
        setNotice({
          loadState: "error",
          message: "YouTube URLを入力してください。"
        });
        return false;
      }

      setNotice({
        loadState: "loading",
        message: "YouTube音声をmp3に変換しています。"
      });

      try {
        const track = await youtubeMutation.mutateAsync(trimmedUrl);

        cacheTrack(queryClient, track);
        setNotice({
          loadState: "ready",
          message: `${track.title} を読み込みました。`
        });
        navigateToTrack(track.id);

        return true;
      } catch (error) {
        setNotice({
          loadState: "error",
          message: getErrorMessage(error, "YouTube変換に失敗しました。")
        });

        return false;
      }
    },
    [navigateToTrack, queryClient, youtubeMutation]
  );

  const deleteTrackFromLibrary = useCallback(
    async (trackId: string) => {
      const track = tracksQuery.data?.find(
        (libraryTrack) => libraryTrack.id === trackId
      );

      if (!track || !window.confirm(`${track.title} を削除しますか？`)) {
        return;
      }

      setNotice({
        loadState: "loading",
        message: `${track.title} を削除しています。`
      });

      try {
        await deleteMutation.mutateAsync(trackId);
        removeCachedTrack(queryClient, trackId);
        setNotice({
          loadState: "ready",
          message: `${track.title} を削除しました。`
        });
      } catch (error) {
        setNotice({
          loadState: "error",
          message: getErrorMessage(error, "保存済みMP3を削除できませんでした。")
        });
      }
    },
    [deleteMutation, queryClient, tracksQuery.data]
  );

  const refreshTracks = useCallback(() => {
    void tracksQuery.refetch();
  }, [tracksQuery]);

  const isMutating =
    uploadMutation.isPending ||
    youtubeMutation.isPending ||
    deleteMutation.isPending;
  const loadState: LoadState = tracksQuery.isError
    ? "error"
    : isMutating || tracksQuery.isFetching
      ? "loading"
      : notice.loadState;
  const message = tracksQuery.isError
    ? getErrorMessage(
        tracksQuery.error,
        "ライブラリ一覧を読み込めませんでした。"
      )
    : tracksQuery.isLoading
      ? "ライブラリ一覧を読み込んでいます。"
      : notice.message;

  return useMemo(
    () => ({
      convertYoutube,
      deleteTrackFromLibrary,
      isConverting: youtubeMutation.isPending,
      isLibraryLoading: tracksQuery.isFetching,
      isUploading: uploadMutation.isPending,
      loadState,
      message,
      refreshTracks,
      tracks: tracksQuery.data ?? [],
      uploadFile
    }),
    [
      convertYoutube,
      deleteTrackFromLibrary,
      loadState,
      message,
      refreshTracks,
      tracksQuery.data,
      tracksQuery.isFetching,
      uploadFile,
      uploadMutation.isPending,
      youtubeMutation.isPending
    ]
  );
}

export type LibraryState = ReturnType<typeof useLibraryState>;
