import { useId, useState } from "react";
import { Check, LoaderCircle, X } from "lucide-react";
import { IconButton } from "../../components/ui/Button";
import { TextInput } from "../../components/ui/TextInput";
import type { FoldersState } from "./useFolders";

export function FolderNameForm({
  initialName = "",
  folderId,
  mutation,
  onDone,
  onCancel
}: {
  initialName?: string;
  folderId?: string;
  mutation: FoldersState["saveMutation"];
  onDone: (folderId: string) => void;
  onCancel: () => void;
}) {
  const inputId = useId();
  const [name, setName] = useState(initialName);
  return (
    <form
      className="min-w-0"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim() && !mutation.isPending) {
          mutation.mutate(
            { name: name.trim(), folderId },
            { onSuccess: (folder) => onDone(folder.id) }
          );
        }
      }}
    >
      <label className="mb-2 block text-sm text-muted" htmlFor={inputId}>
        フォルダ名
      </label>
      <div className="flex min-w-0 items-center gap-1">
        <TextInput
          id={inputId}
          autoFocus
          required
          maxLength={80}
          className="w-full rounded-lg"
          value={name}
          disabled={mutation.isPending}
          placeholder="例：練習中の曲"
          onChange={(event) => {
            setName(event.target.value);
            mutation.reset();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !mutation.isPending) {
              event.preventDefault();
              onCancel();
            }
          }}
          onFocus={(event) => event.currentTarget.select()}
        />
        <IconButton
          type="submit"
          title="フォルダ名を保存"
          disabled={!name.trim() || mutation.isPending}
          variant="accent"
        >
          {mutation.isPending ? (
            <LoaderCircle size={16} className="animate-spin" />
          ) : (
            <Check size={16} />
          )}
        </IconButton>
        <IconButton
          title="フォルダ名の編集をキャンセル"
          disabled={mutation.isPending}
          onClick={onCancel}
        >
          <X size={16} />
        </IconButton>
      </div>
      {mutation.error && (
        <p className="mt-2 text-sm text-danger" role="alert">
          {mutation.error.message}
        </p>
      )}
    </form>
  );
}
