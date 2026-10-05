import { useDragDropMonitor } from "@dnd-kit/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { tracksQueryKey } from "../../lib/api";
import type { LibraryScope } from "../../lib/folders";
import type { TrackSummary } from "../../lib/library";
import { moveTrackToIndex, readTrackOrderDragData } from "../../lib/trackOrder";
import { saveTrackOrder } from "../../lib/trackOrderApi";
import { TrackOrderRow } from "./TrackOrderRow";

export function TrackOrderEditor({ tracks, scope, onDone }: {
  tracks: TrackSummary[];
  scope: LibraryScope;
  onDone: () => void;
}) {
  // Keep a snapshot so background refreshes cannot silently replace a draft.
  const [original] = useState(() => tracks);
  const [trackIds, setTrackIds] = useState(() => tracks.map((track) => track.id));
  const [announcement, setAnnouncement] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: saveTrackOrder,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: tracksQueryKey });
      onDone();
    }
  });
  useEffect(() => { headingRef.current?.focus(); }, []);
  const byId = new Map(original.map((track) => [track.id, track]));
  const changed = trackIds.some((id, index) => id !== original[index].id);
  const move = (trackId: string, index: number) => {
    if (mutation.isPending) return;
    mutation.reset();
    setTrackIds((ids) => moveTrackToIndex(ids, trackId, index));
    setAnnouncement(`${byId.get(trackId)?.title ?? "曲"} を ${index + 1} 番目に移動しました。`);
  };
  useDragDropMonitor({
    onBeforeDragStart: (event) => { if (mutation.isPending) event.preventDefault(); },
    onDragEnd: ({ operation, canceled }) => {
      if (canceled || mutation.isPending) return;
      const source = readTrackOrderDragData(operation.source?.data);
      const target = readTrackOrderDragData(operation.target?.data);
      if (!source || !target || source.trackId === target.trackId) return;
      const index = trackIds.indexOf(target.trackId);
      if (index >= 0) move(source.trackId, index);
    }
  });
  return (
    <section className="px-5 pb-7 sm:px-7" aria-label="曲順の編集" aria-busy={mutation.isPending}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 ref={headingRef} tabIndex={-1} className="font-medium outline-none">曲順を並べ替え</h3>
          <p className="mt-2 text-sm text-muted">ドラッグ、または上下ボタンで移動できます。</p>
        </div>
        <div className="flex gap-2">
          <Button disabled={mutation.isPending} onClick={async () => {
            await queryClient.invalidateQueries({ queryKey: tracksQueryKey });
            onDone();
          }}>{mutation.isError ? "一覧に戻る" : "キャンセル"}</Button>
          <Button variant="accent" disabled={!changed || mutation.isPending} onClick={() => mutation.mutate({
            scope, previousTrackIds: original.map((track) => track.id), trackIds
          })}>{mutation.isPending ? "保存中…" : "曲順を保存"}</Button>
        </div>
      </div>
      {mutation.isError && <p role="alert" className="mb-4 text-sm text-danger">{mutation.error.message}</p>}
      <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
      <ol aria-label="曲順" className="min-w-0 border-t border-line">
        {trackIds.map((id, index) => (
          <TrackOrderRow key={id} trackId={id} title={byId.get(id)?.title ?? "曲"} index={index}
            count={trackIds.length} disabled={mutation.isPending} onMove={move} />
        ))}
      </ol>
    </section>
  );
}
