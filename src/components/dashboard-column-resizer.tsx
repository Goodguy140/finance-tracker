"use client";

import { useCallback, useRef } from "react";
import { MIN_COLUMN_UNITS, TOTAL_COLUMN_UNITS } from "@/lib/dashboard-layout/schema";

/**
 * The draggable boundary between two columns.
 *
 * Resizing writes `gridTemplateColumns` straight onto the grid element while the pointer is
 * down and only commits to React state on release. A state update per pointermove would
 * re-render every card body at pointer rate, and each card's recharts container re-measures
 * on its own ResizeObserver tick as well — together that is what makes a resize feel broken.
 */
export function DashboardColumnResizer({
  index,
  leftWeight,
  rightWeight,
  minUnits,
  gridRef,
  onPreview,
  onCommit,
}: {
  index: number;
  leftWeight: number;
  rightWeight: number;
  minUnits: number;
  gridRef: React.RefObject<HTMLDivElement | null>;
  /** Returns the track template for a candidate delta, for the imperative preview. */
  onPreview: (deltaUnits: number) => string;
  onCommit: (deltaUnits: number) => void;
}) {
  const dragRef = useRef<{ startX: number; width: number; delta: number } | null>(null);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const grid = gridRef.current;
      if (!grid) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = { startX: event.clientX, width: grid.getBoundingClientRect().width, delta: 0 };
    },
    [gridRef],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      const grid = gridRef.current;
      if (!drag || !grid || drag.width <= 0) return;
      const deltaUnits = Math.round(((event.clientX - drag.startX) / drag.width) * TOTAL_COLUMN_UNITS);
      if (deltaUnits === drag.delta) return;
      drag.delta = deltaUnits;
      grid.style.gridTemplateColumns = onPreview(deltaUnits);
    },
    [gridRef, onPreview],
  );

  const endDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      // Hand the track back to React; it re-derives the template from the committed weights.
      if (gridRef.current) gridRef.current.style.gridTemplateColumns = "";
      if (drag.delta !== 0) onCommit(drag.delta);
    },
    [gridRef, onCommit],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const steps: Record<string, number | undefined> = {
        ArrowLeft: -1,
        ArrowRight: 1,
        Home: minUnits - leftWeight,
        End: rightWeight - minUnits,
      };
      const delta = steps[event.key];
      if (delta === undefined || delta === 0) return;
      event.preventDefault();
      onCommit(delta);
    },
    [leftWeight, rightWeight, minUnits, onCommit],
  );

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize columns ${index + 1} and ${index + 2}`}
      aria-valuemin={Math.max(MIN_COLUMN_UNITS, minUnits)}
      aria-valuemax={TOTAL_COLUMN_UNITS - Math.max(MIN_COLUMN_UNITS, minUnits)}
      aria-valuenow={leftWeight}
      aria-valuetext={`${Math.round((leftWeight / TOTAL_COLUMN_UNITS) * 100)}% and ${Math.round((rightWeight / TOTAL_COLUMN_UNITS) * 100)}%`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      className="group -mx-1.5 flex w-3 shrink-0 cursor-col-resize touch-none items-stretch justify-center rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
    >
      <span className="my-2 w-0.5 rounded-full bg-slate-700 transition group-hover:bg-blue-400 group-focus-visible:bg-blue-400" aria-hidden />
    </div>
  );
}
