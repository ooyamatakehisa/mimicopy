import { useEffect, useRef, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "../../components/ui/Button";
import type { LibraryFolder } from "../../lib/folders";
import type { FoldersState } from "./useFolders";
import { FolderNameForm } from "./FolderNameForm";

export function FolderActions({
  folder,
  folders,
  onDeleted
}: {
  folder: LibraryFolder;
  folders: FoldersState;
  onDeleted: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const renameRef = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (!editing && wasEditing.current) renameRef.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  const finishEditing = () => {
    setEditing(false);
  };
  if (editing)
    return (
      <div className="w-full max-w-md">
        <FolderNameForm
          initialName={folder.name}
          folderId={folder.id}
          mutation={folders.saveMutation}
          onCancel={finishEditing}
          onDone={finishEditing}
        />
      </div>
    );
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <Button
          ref={renameRef}
          size="sm"
          disabled={
            folders.deleteMutation.isPending || folders.saveMutation.isPending
          }
          onClick={() => {
            folders.saveMutation.reset();
            setEditing(true);
          }}
        >
          <Pencil size={14} />
          名前を変更
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={
            folders.deleteMutation.isPending || folders.saveMutation.isPending
          }
          onClick={() => {
            if (
              window.confirm(
                `「${folder.name}」を削除しますか？\n曲は削除されず、「未分類」に戻ります。`
              )
            ) {
              folders.deleteMutation.mutate(folder.id, {
                onSuccess: onDeleted
              });
            }
          }}
        >
          <Trash2 size={14} />
          {folders.deleteMutation.isPending ? "削除中…" : "フォルダを削除"}
        </Button>
      </div>
      {folders.deleteMutation.error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {folders.deleteMutation.error.message}
        </p>
      )}
    </div>
  );
}
