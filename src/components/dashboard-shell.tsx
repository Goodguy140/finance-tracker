"use client";

import { useState } from "react";
import { DashboardGrid, type DashboardCardContentMap } from "@/components/dashboard-grid";
import type { DashboardLayout } from "@/lib/dashboard-layout/schema";

/**
 * Owns the edit-mode flag and the "Edit layout" control, so the two live in one client
 * component rather than being threaded through the server-rendered header.
 *
 * Editing is off by default and is not persisted. These cards are wall to wall interactive —
 * a live expense form, inline edit dialogs, chart tooltips, a scrollable log with per-row
 * buttons — so an always-on drag sensor would compete with all of it, and drag handles and
 * resize gutters are noise on a dashboard that is mostly read.
 */
export function DashboardShell({
  storedLayout,
  cards,
}: {
  storedLayout: DashboardLayout;
  cards: DashboardCardContentMap;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <>
      {!editing ? (
        <div className="mb-2 hidden justify-end lg:flex">
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
        editing={editing}
        onEditingChange={setEditing}
      />
    </>
  );
}
