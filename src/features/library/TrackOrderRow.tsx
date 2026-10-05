import { useDraggable, useDroppable } from "@dnd-kit/react";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { IconButton } from "../../components/ui/Button";
import { cn } from "../../lib/cn";
import { readTrackOrderDragData, type TrackOrderDragData } from "../../lib/trackOrder";

export function TrackOrderRow({ trackId, title, index, count, disabled, onMove }: {
  trackId: string;
  title: string;
  index: number;
  count: number;
  disabled: boolean;
  onMove: (trackId: string, index: number) => void;
}) {
  const data: TrackOrderDragData = { kind: "track-order", trackId, title };
  const { ref: dragRef, handleRef, isDragSource } = useDraggable({
    id: `order:${trackId}`, type: "track-order", data, disabled
  });
  const { ref: dropRef, isDropTarget } = useDroppable({
    id: `order:${trackId}`, data, disabled,
    accept: (source) => {
      const item = readTrackOrderDragData(source.data);
      return Boolean(item && item.trackId !== trackId);
    }
  });
  return (
    <li
      ref={(element) => { dragRef(element); dropRef(element); }}
      data-testid={`order-track-${trackId}`}
      data-drop-active={isDropTarget || undefined}
      className={cn(
        "grid min-w-0 grid-cols-[44px_minmax(0,1fr)] items-center gap-2 border-b border-line py-3 sm:flex sm:gap-3",
        isDragSource && "opacity-40",
        isDropTarget && "bg-teal/15 outline-2 outline-teal"
      )}
    >
      <IconButton
        ref={handleRef}
        data-drag-handle
        title={`${title} の曲順をドラッグ`}
        className="row-span-2 size-11 cursor-grab touch-none self-start border-transparent bg-transparent shadow-none sm:self-auto"
        disabled={disabled}
      >
        <GripVertical size={18} />
      </IconButton>
      <div className="flex min-w-0 flex-1 items-baseline gap-3">
        <span className="min-w-5 text-right text-xs tabular-nums text-muted">{index + 1}</span>
        <span className="min-w-0 flex-1 break-words text-sm">{title}</span>
      </div>
      <div className="col-start-2 flex shrink-0 justify-end gap-1">
        <IconButton
          title={`${title} を上へ`}
          className="size-11 aria-disabled:opacity-40"
          aria-disabled={index === 0 || disabled}
          onClick={() => { if (!disabled && index > 0) onMove(trackId, index - 1); }}
        >
          <ArrowUp size={17} />
        </IconButton>
        <IconButton
          title={`${title} を下へ`}
          className="size-11 aria-disabled:opacity-40"
          aria-disabled={index === count - 1 || disabled}
          onClick={() => { if (!disabled && index < count - 1) onMove(trackId, index + 1); }}
        >
          <ArrowDown size={17} />
        </IconButton>
      </div>
    </li>
  );
}
