import type { ReactNode } from "react";
import {
  DragDropProvider,
  DragOverlay,
  useDragDropManager
} from "@dnd-kit/react";
import {
  Accessibility,
  KeyboardSensor,
  PointerActivationConstraints,
  PointerSensor
} from "@dnd-kit/dom";
import { Music2 } from "lucide-react";
import {
  readFolderDropData,
  readTrackDragData,
  type TrackDragData
} from "../../lib/libraryDrag";

const sensors = [
  PointerSensor.configure({
    activatorElements: (source) => [source.element],
    activationConstraints: (event) =>
      event.pointerType === "touch"
        ? [new PointerActivationConstraints.Delay({ value: 250, tolerance: 8 })]
        : [new PointerActivationConstraints.Distance({ value: 8 })],
    preventActivation: (event, source) =>
      !source.handle?.getClientRects().length ||
      (event.target instanceof Element &&
        Boolean(
          event.target.closest(
            'input, select, textarea, [contenteditable="true"], button:not([data-track-link]):not([data-drag-handle])'
          )
        ))
  }),
  KeyboardSensor
];

const accessibilityOptions: NonNullable<
  ConstructorParameters<typeof Accessibility>[1]
> = {
  screenReaderInstructions: {
    draggable:
      "SpaceまたはEnterを押すとドラッグを開始します。矢印キーで移動、Shiftと矢印キーで大きく移動、もう一度Spaceでドロップ、Escapeでキャンセルできます。移動ボタンからフォルダを選ぶこともできます。"
  },
  announcements: {
    dragstart: ({ operation }) => {
      const source = readTrackDragData(operation.source?.data);
      return source
        ? `${source.trackIds.length} 曲のドラッグを開始しました。`
        : undefined;
    },
    dragover: ({ operation }) => {
      const target = readFolderDropData(operation.target?.data);
      return target
        ? `移動先：${target.name}`
        : "移動先のフォルダに重ねてください。";
    },
    dragend: ({ operation, canceled }) => {
      const target = readFolderDropData(operation.target?.data);
      return canceled || !target
        ? "移動をキャンセルしました。"
        : `${target.name} への移動をリクエストしました。`;
    }
  }
};
const accessibility = Accessibility.configure(accessibilityOptions);

function TrackDragPreview({ data }: { data: TrackDragData }) {
  const manager = useDragDropManager();
  const operation = manager?.dragOperation;
  const origin = operation?.shape?.initial.boundingRectangle;
  const pointer = operation?.position.initial;
  // dnd kit positions the overlay from the row's origin. Keep the compact
  // preview beside the pointer so it never covers the destination's label.
  const offset =
    origin && pointer
      ? {
          marginLeft: pointer.x - origin.left + 16,
          marginTop: pointer.y - origin.top + 24
        }
      : undefined;
  return (
    <div
      className="flex max-w-72 items-center gap-3 rounded-xl bg-teal px-4 py-3 text-surface shadow-tight"
      style={offset}
      data-testid="track-drag-preview"
    >
      <Music2 size={20} aria-hidden="true" />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">
          {data.trackIds.length > 1
            ? `${data.trackIds.length} 曲を移動`
            : data.title}
        </p>
        <p className="mt-1 text-xs">フォルダにドロップして移動</p>
      </div>
    </div>
  );
}

export function LibraryDragDrop({ children }: { children: ReactNode }) {
  return (
    <DragDropProvider
      sensors={sensors}
      plugins={(defaults) => [...defaults, accessibility]}
    >
      {children}
      <DragOverlay dropAnimation={null}>
        {(source) => {
          const data = readTrackDragData(source.data);
          return data && <TrackDragPreview data={data} />;
        }}
      </DragOverlay>
    </DragDropProvider>
  );
}
