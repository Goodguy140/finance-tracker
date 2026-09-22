"use client";

import { MAX_COLUMNS } from "@/lib/dashboard-layout/schema";

export type LayoutSaveStatus = "idle" | "saving" | "saved" | "error";

export function DashboardEditToolbar({
  columnCount,
  canAddColumn,
  saveStatus,
  onAddColumn,
  onReset,
  onDone,
  onRetry,
}: {
  columnCount: number;
  canAddColumn: boolean;
  saveStatus: LayoutSaveStatus;
  onAddColumn: () => void;
  onReset: () => void;
  onDone: () => void;
  onRetry: () => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Dashboard layout"
      className="sticky top-2 z-30 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-blue-500/30 bg-slate-900/95 p-2 shadow-lg backdrop-blur"
    >
      <span className="px-1 text-sm font-medium text-blue-200">Editing layout</span>
      <span className="text-xs text-slate-400">
        {columnCount} column{columnCount === 1 ? "" : "s"}
      </span>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <SaveStatusPill status={saveStatus} onRetry={onRetry} />
        <button
          type="button"
          onClick={onAddColumn}
          disabled={!canAddColumn}
          title={
            canAddColumn
              ? undefined
              : `A dashboard can hold up to ${MAX_COLUMNS} columns, each wide enough to read.`
          }
          className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Add column
        </button>
        <button
          type="button"
          onClick={onReset}
          className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-800"
        >
          Reset layout
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg bg-blue-500/20 px-3 py-1.5 text-xs font-semibold text-blue-100 ring-1 ring-blue-500/40 transition hover:bg-blue-500/30"
        >
          Done
        </button>
      </div>
    </div>
  );
}

function SaveStatusPill({ status, onRetry }: { status: LayoutSaveStatus; onRetry: () => void }) {
  if (status === "error") {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-xs font-medium text-red-200 transition hover:bg-red-500/20"
      >
        Couldn’t save layout — retry
      </button>
    );
  }
  return (
    <span
      // Layout saves are a background concern; announce politely rather than interrupting.
      aria-live="polite"
      className="px-1 text-xs text-slate-500"
    >
      {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : ""}
    </span>
  );
}
