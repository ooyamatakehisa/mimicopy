import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, LoaderCircle, Pencil, X } from "lucide-react";
import { IconButton } from "../../components/ui/Button";
import { TextInput } from "../../components/ui/TextInput";
import { updateTrackTitle } from "../../lib/api";
import { cacheTrack } from "../../lib/trackQueryCache";
import { formatTime } from "../../lib/playback";

/** Owns the track-name editing workflow; playback only supplies the time readout. */
export function TrackHeading({ title, trackId, currentTime, duration, message, onBack }: {
  title: string;
  trackId: string;
  currentTime: number;
  duration: number;
  message: string | null;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: updateTrackTitle,
    onSuccess: (track) => { cacheTrack(queryClient, track); setDraft(null); }
  });
  const save = () => {
    const trimmed = draft?.trim();
    if (!trimmed) return;
    if (trimmed === title) setDraft(null);
    else mutation.mutate({ trackId, title: trimmed });
  };
  const status = mutation.isError
    ? mutation.error instanceof Error ? mutation.error.message : "表示名を保存できませんでした。"
    : mutation.isPending ? "曲名を保存中…"
    : message ?? (mutation.isSuccess ? `${mutation.data.title} に変更しました。` : null);

  return (
    <header aria-label="曲の情報" className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 rounded-2xl border border-line bg-surface px-2 py-2 lg:px-4 lg:py-3">
      <IconButton className="size-11" title="ライブラリへ戻る" onClick={onBack}><ArrowLeft size={20} /></IconButton>
      {draft === null ? (
        <>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold text-ink sm:text-lg" title={title}>{title}</h1>
            <p className="mt-0.5 text-xs tabular-nums text-muted" aria-label="再生時間">{formatTime(currentTime)} / {formatTime(duration)}</p>
          </div>
          <IconButton className="size-11" title="表示名を編集" onClick={() => { mutation.reset(); setDraft(title); }}><Pencil size={17} /></IconButton>
        </>
      ) : (
        <form className="col-span-2 flex min-w-0 items-center gap-1" onSubmit={(event) => { event.preventDefault(); save(); }}>
          <TextInput autoFocus className="w-full rounded-lg text-base" aria-label={`${title} display name`}
            value={draft} maxLength={180} disabled={mutation.isPending}
            onChange={(event) => setDraft(event.target.value)} onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => { if (event.key === "Escape") { mutation.reset(); setDraft(null); } }} />
          <IconButton className="size-11" type="submit" title="表示名を保存" disabled={!draft.trim() || mutation.isPending}>
            {mutation.isPending ? <LoaderCircle size={17} className="animate-spin" /> : <Check size={17} />}
          </IconButton>
          <IconButton className="size-11" title="表示名の編集をキャンセル" disabled={mutation.isPending}
            onClick={() => { mutation.reset(); setDraft(null); }}><X size={17} /></IconButton>
        </form>
      )}
      {status ? <p className="col-span-3 mt-1 px-1 text-sm text-muted" role={mutation.isError ? "alert" : "status"}>{status}</p> : null}
    </header>
  );
}
