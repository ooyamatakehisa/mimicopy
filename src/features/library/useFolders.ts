import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteFolder,
  fetchFolders,
  foldersQueryKey,
  moveTracks,
  saveFolder
} from "../../lib/folderApi";
import { tracksQueryKey } from "../../lib/api";

export function useFolders() {
  const queryClient = useQueryClient();
  const foldersQuery = useQuery({
    queryKey: foldersQueryKey,
    queryFn: fetchFolders
  });
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: foldersQueryKey }),
      queryClient.invalidateQueries({ queryKey: tracksQueryKey }),
      queryClient.invalidateQueries({ queryKey: ["track"] })
    ]);
  };
  const saveMutation = useMutation({
    mutationFn: saveFolder,
    onSuccess: refresh
  });
  const deleteMutation = useMutation({
    mutationFn: deleteFolder,
    onSuccess: refresh
  });
  const moveMutation = useMutation({
    mutationFn: moveTracks,
    onSuccess: refresh
  });
  return { foldersQuery, saveMutation, deleteMutation, moveMutation, refresh };
}
export type FoldersState = ReturnType<typeof useFolders>;
