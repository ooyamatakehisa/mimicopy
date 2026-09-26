import { useId, useState } from "react";
import { FolderInput, LoaderCircle } from "lucide-react";
import { Button } from "../../components/ui/Button";
import type { FoldersState } from "./useFolders";

export function MoveTracksForm({
  trackIds,
  folders,
  onDone,
  onCancel
}: {
  trackIds: string[];
  folders: FoldersState;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [destination, setDestination] = useState("");
  const selectId = useId();
  const mutation = folders.moveMutation;
  return (
    <form
      className="border-y border-teal/25 bg-teal/5 px-5 py-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (destination && !mutation.isPending) {
          mutation.mutate(
            {
              trackIds,
              folderId: destination === "unfiled" ? null : destination
            },
            { onSuccess: onDone }
          );
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <label
          className="flex items-center gap-2 text-sm font-medium"
          htmlFor={selectId}
        >
          <FolderInput size={18} />
          {trackIds.length} 曲の移動先
        </label>
        <select
          id={selectId}
          autoFocus
          className="library-select min-w-0 flex-1 sm:max-w-72"
          value={destination}
          disabled={mutation.isPending || folders.foldersQuery.isError}
          required
          onChange={(event) => setDestination(event.target.value)}
        >
          <option value="" disabled>
            フォルダを選択
          </option>
          <option value="unfiled">未分類（フォルダから外す）</option>
          {folders.foldersQuery.data?.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name}
            </option>
          ))}
        </select>
        <Button
          type="submit"
          variant="accent"
          disabled={!destination || mutation.isPending || trackIds.length > 500}
        >
          {mutation.isPending && (
            <LoaderCircle size={16} className="animate-spin" />
          )}
          {mutation.isPending ? "移動中…" : "移動する"}
        </Button>
        <Button disabled={mutation.isPending} onClick={onCancel}>
          キャンセル
        </Button>
      </div>
      {trackIds.length > 500 && (
        <p className="mt-2 text-sm text-danger" role="alert">
          一度に移動できるのは500曲までです。選択を減らしてください。
        </p>
      )}
      {mutation.error && (
        <p className="mt-2 text-sm text-danger" role="alert">
          {mutation.error.message}
        </p>
      )}
    </form>
  );
}
