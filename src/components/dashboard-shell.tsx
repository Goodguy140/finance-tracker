"use client";

import { useLayoutEffect, useState } from "react";
import { DashboardGrid, type DashboardCardContentMap } from "@/components/dashboard-grid";
import type { DashboardLayout } from "@/lib/dashboard-layout/schema";
import type { DashboardReadability } from "@/lib/dashboard-readability";

/**
 * Owns the edit-mode flag and the "Edit layout" control, so the two live in one client
 * component rather than being threaded through the server-rendered header.
 *
 * Editing is off by default and is not persisted. These cards are wall to wall interactive —
 * a live expense form, inline edit dialogs, chart tooltips, a scrollable log with per-row
 * buttons — so an always-on drag sensor would compete with all of it, and drag handles and
 * resize gutters are noise on a dashboard that is mostly read.
 */
/** The page container whose width follows the column count; see the note at its markup. */
export const DASHBOARD_CONTAINER_ID = "dashboard-container";

const WIDE_CLASS = "max-w-[1800px]";
const NARROW_CLASS = "max-w-7xl";

export function DashboardShell({
  storedLayout,
  cards,
  readability,
}: {
  storedLayout: DashboardLayout;
  cards: DashboardCardContentMap;
  readability: DashboardReadability;
}) {
  const [editing, setEditing] = useState(false);
  const [columnCount, setColumnCount] = useState(storedLayout.columns.length);

  // The container is rendered by the server component above this one, so adding a third
  // column has to reach it imperatively — the alternative is a full revalidate of a page
  // that runs seventeen queries, mid-edit.
  useLayoutEffect(() => {
    const node = document.getElementById(DASHBOARD_CONTAINER_ID);
    if (!node) return;
    const wide = columnCount > 2;
    node.classList.toggle(WIDE_CLASS, wide);
    node.classList.toggle(NARROW_CLASS, !wide);
  }, [columnCount]);

  return (
    <>
      {!editing ? (
        <div className="mb-2 hidden items-center justify-end gap-2 lg:flex">
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
            Beta
          </span>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-900/80 px-2.5 py-1 text-xs font-medium text-slate-300 transition hover:border-slate-600 hover:bg-slate-800 hover:text-slate-100"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
              <path d="M2 2h5v5H2V2Zm7 0h5v3H9V2ZM2 9h5v5H2V9Zm7-2h5v7H9V7Z" />
            </svg>
            Edit layout
          </button>
        </div>
      ) : null}
      <DashboardGrid
        storedLayout={storedLayout}
        cards={cards}
        readability={readability}
        editing={editing}
        onEditingChange={setEditing}
        onColumnCountChange={setColumnCount}
      />
    </>
  );
}
