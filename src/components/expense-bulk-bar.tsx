"use client";

import { useState } from "react";
import { bulkEditExpensesAction } from "@/app/actions";
import { inputClass, secondaryBtnClass, selectClass } from "@/components/forms/shared";
import { ServerActionForm } from "@/components/server-action-form";
import { showUndoToast } from "@/components/undo-toast";
import type { BulkEditResult } from "@/app/actions/transactions";

type Option = { id: string; name: string };

const applyBtnClass =
  "shrink-0 touch-manipulation rounded-lg border border-blue-400/50 bg-blue-500/15 px-2.5 py-1.5 text-xs font-medium text-blue-100 transition hover:bg-blue-500/25 disabled:cursor-not-allowed disabled:opacity-40";

/**
 * What to do with the expenses ticked in the Expense Log: set their category or account, add a
 * tag, or delete them (with Undo). Each change is its own small form so one never carries
 * another's value.
 */
export function ExpenseBulkBar({
  selectedIds,
  totalShown,
  categories,
  accounts,
  onSelectAll,
  onDone,
}: {
  selectedIds: string[];
  totalShown: number;
  categories: Option[];
  accounts: Option[];
  onSelectAll: () => void;
  /** Called after a change lands, with a line saying what happened. */
  onDone: (message: string) => void;
}) {
  const [categoryId, setCategoryId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [tag, setTag] = useState("");
  const ids = JSON.stringify(selectedIds);
  const none = selectedIds.length === 0;

  const report = (verb: string) => (result: BulkEditResult) => {
    const noun = (n: number) => `${n} expense${n === 1 ? "" : "s"}`;
    onDone(
      `${verb} ${noun(result.changed)}${result.skipped ? `. ${noun(result.skipped)} split across categories kept theirs` : ""}.`,
    );
  };

  return (
    <div
      role="group"
      aria-label="Change the selected expenses"
      data-testid="expense-bulk-bar"
      className="space-y-2 rounded-xl border border-blue-500/30 bg-slate-950/80 p-2.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-slate-200">{selectedIds.length} selected</span>
        {selectedIds.length < totalShown ? (
          <button type="button" className="text-xs text-sky-300 hover:text-sky-200" onClick={onSelectAll}>
            Select all {totalShown} shown
          </button>
        ) : null}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <ServerActionForm action={bulkEditExpensesAction} onSuccess={report("Moved")} className="flex items-center gap-1.5">
          <input type="hidden" name="transactionIdsJson" value={ids} />
          <input type="hidden" name="op" value="category" />
          <select
            name="value"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            aria-label="New category for the selected expenses"
            className={`${selectClass} min-w-0 flex-1`}
          >
            <option value="">Category…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button type="submit" className={applyBtnClass} disabled={none || !categoryId}>
            Set category
          </button>
        </ServerActionForm>
        <ServerActionForm action={bulkEditExpensesAction} onSuccess={report("Moved")} className="flex items-center gap-1.5">
          <input type="hidden" name="transactionIdsJson" value={ids} />
          <input type="hidden" name="op" value="account" />
          <select
            name="value"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            aria-label="New account for the selected expenses"
            className={`${selectClass} min-w-0 flex-1`}
          >
            <option value="">Account…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <button type="submit" className={applyBtnClass} disabled={none || !accountId}>
            Set account
          </button>
        </ServerActionForm>
        <ServerActionForm
          action={bulkEditExpensesAction}
          onSuccess={(result) => {
            setTag("");
            report("Tagged")(result);
          }}
          className="flex items-center gap-1.5"
        >
          <input type="hidden" name="transactionIdsJson" value={ids} />
          <input type="hidden" name="op" value="tag" />
          <input
            name="value"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            placeholder="Tag…"
            aria-label="Tag to add to the selected expenses"
            className={`${inputClass} min-w-0 flex-1`}
            autoComplete="off"
          />
          <button type="submit" className={applyBtnClass} disabled={none || !tag.trim()}>
            Add tag
          </button>
        </ServerActionForm>
        <ServerActionForm
          action={bulkEditExpensesAction}
          onSuccess={(result) => {
            showUndoToast(`${result.changed} expense${result.changed === 1 ? "" : "s"} deleted`, result.undoIds);
            onDone("");
          }}
          className="flex items-center justify-end"
        >
          <input type="hidden" name="transactionIdsJson" value={ids} />
          <input type="hidden" name="op" value="delete" />
          <button type="submit" className={`${secondaryBtnClass} text-red-200`} disabled={none}>
            Delete selected
          </button>
        </ServerActionForm>
      </div>
    </div>
  );
}
