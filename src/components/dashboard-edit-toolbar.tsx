"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MAX_COLUMNS, type DashboardCardId } from "@/lib/dashboard-layout/schema";
import type { AddCardTarget } from "@/lib/dashboard-layout/visibility";

export type LayoutSaveStatus = "idle" | "saving" | "saved" | "error";

/** A place a removed card can go back to, as the Add card menu offers it. */
export type AddCardDestination = { key: string; label: string; target: AddCardTarget };

export type RemovedCardOption = { id: DashboardCardId; title: string };

export function DashboardEditToolbar({
  columnCount,
  canAddColumn,
  saveStatus,
  removedCards,
  destinations,
  onAddCard,
  onAddColumn,
  onReset,
  onDone,
  onRetry,
}: {
  columnCount: number;
  canAddColumn: boolean;
  saveStatus: LayoutSaveStatus;
  removedCards: RemovedCardOption[];
  destinations: AddCardDestination[];
  onAddCard: (cardId: DashboardCardId, target: AddCardTarget) => void;
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
        <AddCardMenu removedCards={removedCards} destinations={destinations} onAddCard={onAddCard} />
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

/**
 * Lists the cards taken off the dashboard and puts one back where the user picks: as a card of
 * its own at the bottom of a column, or as a new tab on a card already there.
 */
function AddCardMenu({
  removedCards,
  destinations,
  onAddCard,
}: {
  removedCards: RemovedCardOption[];
  destinations: AddCardDestination[];
  onAddCard: (cardId: DashboardCardId, target: AddCardTarget) => void;
}) {
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const panelId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const empty = removedCards.length === 0;

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={empty}
        aria-expanded={open}
        aria-controls={panelId}
        title={empty ? "Every card is on the dashboard. Remove one to see it listed here." : undefined}
        className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Add card{empty ? "" : ` (${removedCards.length})`}
      </button>
      {open && !empty ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="Add a card"
          className="absolute right-0 top-full z-40 mt-2 w-[min(92vw,24rem)] space-y-2 rounded-xl border border-slate-700 bg-slate-950/98 p-3 shadow-2xl"
        >
          <p className="text-xs text-slate-400">Cards you removed. Pick where each one goes back.</p>
          <ul className="space-y-2">
            {removedCards.map((card) => {
              const selected = choices[card.id] ?? destinations[0]?.key ?? "";
              const destination = destinations.find((d) => d.key === selected);
              const selectId = `${panelId}-${card.id}`;
              return (
                <li key={card.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 p-2">
                  <label htmlFor={selectId} className="min-w-0 flex-1 text-sm font-medium text-slate-100">
                    {card.title}
                  </label>
                  <select
                    id={selectId}
                    value={selected}
                    onChange={(event) => setChoices((current) => ({ ...current, [card.id]: event.target.value }))}
                    className="max-w-[12rem] rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
                  >
                    {destinations.map((d) => (
                      <option key={d.key} value={d.key}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!destination}
                    onClick={() => {
                      if (!destination) return;
                      onAddCard(card.id, destination.target);
                      if (removedCards.length === 1) setOpen(false);
                    }}
                    aria-label={`Add ${card.title}`}
                    className="rounded-lg bg-blue-500/20 px-2.5 py-1 text-xs font-semibold text-blue-100 ring-1 ring-blue-500/40 transition hover:bg-blue-500/30 disabled:opacity-40"
                  >
                    Add
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
