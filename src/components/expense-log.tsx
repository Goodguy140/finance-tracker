"use client";

import { useActionState, useEffect, useId, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { updateExpenseAction } from "@/app/actions";
import { MetaChip } from "@/components/meta-chip";
import { formatCurrency } from "@/lib/money";
import {
  CurrencyAmountInput,
  DateField,
  LabeledField,
  formGridResponsive,
  primaryBtnClass,
  secondaryBtnClass,
  selectClass,
  spanFullSm,
  textAreaClass,
} from "@/components/forms";

type Option = { id: string; name: string };

export type ExpenseLogEntry = {
  id: string;
  amountCents: number;
  dateYmd: string;
  dateDisplay: string;
  postedDateYmd: string | null;
  postedDateDisplay: string | null;
  title: string | null;
  note: string | null;
  accountId: string;
  categoryId: string;
  accountLabel: string;
  categoryLabel: string;
  isSplit: boolean;
};

type UpdateState = { ok: true } | { ok: false; error: string | null };

type ExpenseLogDensity = "expanded" | "compact";

const EXPENSE_LOG_DENSITY_KEY = "finance-tracker-expense-log-density";

const expenseLogDensityListeners = new Set<() => void>();

function subscribeExpenseLogDensity(listener: () => void) {
  expenseLogDensityListeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === EXPENSE_LOG_DENSITY_KEY || e.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    expenseLogDensityListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function emitExpenseLogDensity() {
  expenseLogDensityListeners.forEach((l) => l());
}

function getExpenseLogDensitySnapshot(): ExpenseLogDensity {
  if (typeof window === "undefined") return "expanded";
  return window.localStorage.getItem(EXPENSE_LOG_DENSITY_KEY) === "compact" ? "compact" : "expanded";
}

function getExpenseLogDensityServerSnapshot(): ExpenseLogDensity {
  return "expanded";
}

function persistExpenseLogDensity(next: ExpenseLogDensity) {
  try {
    window.localStorage.setItem(EXPENSE_LOG_DENSITY_KEY, next);
  } catch {
    /* private mode */
  }
  emitExpenseLogDensity();
}

function AmountPill({ cents, size = "default" }: { cents: number; size?: "default" | "compact" }) {
  const credit = cents < 0;
  const sizeClass =
    size === "compact"
      ? "px-2 py-0.5 text-xs font-semibold tabular-nums"
      : "px-2.5 py-1 text-sm font-semibold tabular-nums";
  return (
    <span
      className={
        credit
          ? `shrink-0 rounded-full border border-emerald-500/35 bg-emerald-500/15 text-emerald-100 ${sizeClass}`
          : `shrink-0 rounded-full border border-blue-500/35 bg-blue-500/15 text-blue-100 ${sizeClass}`
      }
    >
      {formatCurrency(cents)}
    </span>
  );
}

function ExpenseChipRow({ txn }: { txn: ExpenseLogEntry }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {txn.title ? <MetaChip label="Category">{txn.categoryLabel}</MetaChip> : null}
      <MetaChip label="Account">{txn.accountLabel}</MetaChip>
      <MetaChip label="Transaction">{txn.dateDisplay}</MetaChip>
      {txn.postedDateDisplay ? <MetaChip label="Posted">{txn.postedDateDisplay}</MetaChip> : null}
      {txn.note ? <MetaChip label="Note">{txn.note}</MetaChip> : null}
    </div>
  );
}

function ExpenseLogMeta({
  txn,
  density,
  isSplit,
}: {
  txn: ExpenseLogEntry;
  density: ExpenseLogDensity;
  isSplit: boolean;
}) {
  if (density === "compact") {
    const parts: string[] = [];
    if (txn.title) parts.push(txn.categoryLabel);
    parts.push(txn.accountLabel, txn.dateDisplay);
    if (txn.postedDateDisplay) parts.push(`posted ${txn.postedDateDisplay}`);
    if (txn.note) parts.push(txn.note);
    const line = parts.join(" · ");
    const fullTitle = [isSplit ? "Split (view only)" : null, line].filter(Boolean).join(" · ");
    return (
      <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-slate-400 sm:text-xs" title={fullTitle}>
        {isSplit ? (
          <>
            <span className="font-medium text-amber-300/90">Split</span>
            <span className="text-slate-600"> · </span>
          </>
        ) : null}
        {line}
      </p>
    );
  }

  return (
    <>
      {isSplit ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center rounded-full border border-amber-500/35 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-100 sm:text-xs">
            Split — view only
          </span>
        </div>
      ) : null}
      <ExpenseChipRow txn={txn} />
    </>
  );
}

function ExpenseLogDensityToggle({
  density,
  onChange,
}: {
  density: ExpenseLogDensity;
  onChange: (next: ExpenseLogDensity) => void;
}) {
  const expanded = density === "expanded";
  return (
    <div className="flex items-center gap-2 sm:gap-2.5">
      <span className={`text-xs ${expanded ? "text-slate-500" : "font-medium text-slate-200"}`}>Compact</span>
      <button
        type="button"
        role="switch"
        aria-checked={expanded}
        aria-label="Expense log layout: compact or expanded with chips"
        title={expanded ? "Expanded: detail chips" : "Compact: dense summary"}
        onClick={() => onChange(expanded ? "compact" : "expanded")}
        className="relative h-7 w-11 shrink-0 rounded-full border border-slate-600 bg-slate-800 transition-colors hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 touch-manipulation"
      >
        <span
          className={`absolute top-1 left-1 block h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ease-out ${
            expanded ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </button>
      <span className={`text-xs ${expanded ? "font-medium text-slate-200" : "text-slate-500"}`}>Expanded</span>
    </div>
  );
}

function EditExpenseModal({
  entry,
  accounts,
  categories,
  onClose,
}: {
  entry: ExpenseLogEntry;
  accounts: Option[];
  categories: Option[];
  onClose: () => void;
}) {
  const router = useRouter();
  const fieldIds = useId();

  const [state, formAction, isPending] = useActionState(
    async (_prev: UpdateState, formData: FormData): Promise<UpdateState> => {
      try {
        await updateExpenseAction(formData);
        return { ok: true };
      } catch (e) {
        const message = e instanceof Error ? e.message : "Could not save changes.";
        return { ok: false, error: message };
      }
    },
    { ok: false, error: null },
  );

  useEffect(() => {
    if (state.ok) {
      onClose();
      router.refresh();
    }
  }, [state, onClose, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const amountDollars = (entry.amountCents / 100).toFixed(2);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-expense-title"
        className="max-h-[min(90dvh,40rem)] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-slate-700 border-b-0 bg-slate-900 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 shadow-2xl sm:rounded-2xl sm:border-b sm:px-5 sm:pb-5 sm:pt-5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 id="edit-expense-title" className="mb-4 text-lg font-semibold text-slate-100">
          Edit expense
        </h3>
        <form action={formAction} className={formGridResponsive}>
          <input type="hidden" name="transactionId" value={entry.id} />
          <LabeledField label="Account" hint="Financial account this expense is charged to.">
            <select id={`${fieldIds}-account`} name="accountId" className={selectClass} defaultValue={entry.accountId}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </LabeledField>
          <LabeledField label="Category" hint="Expense category for budgeting and reports.">
            <select id={`${fieldIds}-category`} name="categoryId" className={selectClass} defaultValue={entry.categoryId}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </LabeledField>
          <CurrencyAmountInput
            name="amount"
            label="Amount"
            placeholder="0.00 (negative for credits)"
            defaultValue={amountDollars}
            required
          />
          <DateField
            name="date"
            label="Transaction date"
            hint="The date you assign to this purchase or charge."
            defaultValue={entry.dateYmd}
            required
          />
          <DateField
            name="postedDate"
            label="Posted date"
            hint="Optional. When the transaction cleared on your statement, if different from the transaction date."
            defaultValue={entry.postedDateYmd ?? undefined}
            className={spanFullSm}
          />
          <LabeledField
            label="Title"
            hint="Optional. Shown in your expense log (max 120 characters)."
            className={spanFullSm}
          >
            <textarea
              name="title"
              rows={3}
              maxLength={120}
              className={textAreaClass}
              placeholder="e.g. Weekly groceries, Shell fuel"
              defaultValue={entry.title ?? ""}
            />
          </LabeledField>
          <LabeledField label="Note" hint="Optional details (max 250 characters)." className={spanFullSm}>
            <textarea
              name="note"
              rows={5}
              maxLength={250}
              className={textAreaClass}
              placeholder="Extra context, memo, or split notes"
              defaultValue={entry.note ?? ""}
            />
          </LabeledField>
          <p className={`${spanFullSm} text-xs leading-relaxed text-slate-400`}>
            Use a negative amount for statement credits (refunds, chargebacks). They use the same category and reduce net
            spend in budgets.
          </p>
          {state.ok === false && state.error ? (
            <p className={`${spanFullSm} text-sm text-red-300`}>{state.error}</p>
          ) : null}
          <div className={`${spanFullSm} flex flex-col gap-2 pt-1 sm:flex-row sm:flex-wrap`}>
            <button
              type="submit"
              disabled={isPending}
              className={`w-full ${primaryBtnClass} py-2.5 sm:w-auto sm:py-2`}
            >
              {isPending ? "Saving…" : "Save changes"}
            </button>
            <button type="button" className={`w-full ${secondaryBtnClass} py-2.5 sm:w-auto sm:py-2`} onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ExpenseLogPanel({
  entries,
  accounts,
  categories,
}: {
  entries: ExpenseLogEntry[];
  accounts: Option[];
  categories: Option[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const density = useSyncExternalStore(
    subscribeExpenseLogDensity,
    getExpenseLogDensitySnapshot,
    getExpenseLogDensityServerSnapshot,
  );
  const editing = editingId ? entries.find((e) => e.id === editingId) : null;

  const cardPad = density === "compact" ? "p-2" : "p-2.5";
  const pillSize = density === "compact" ? "compact" : "default";

  return (
    <>
      {entries.length > 0 ? (
        <div className="mb-2 flex justify-end">
          <ExpenseLogDensityToggle density={density} onChange={persistExpenseLogDensity} />
        </div>
      ) : null}
      <div className="max-h-[min(70vh,36rem)] space-y-2 overflow-y-auto pr-1">
        {entries.length === 0 ? (
          <p className="text-sm text-slate-400">No expenses in this period.</p>
        ) : (
          entries.map((txn) => (
            <div key={txn.id}>
              {txn.isSplit ? (
                <div
                  className={`rounded-xl border border-slate-800 bg-slate-950/50 text-sm opacity-90 ${cardPad}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <span className="min-w-0 flex-1 font-semibold leading-snug text-slate-100">
                      {txn.title || txn.categoryLabel}
                    </span>
                    <AmountPill cents={txn.amountCents} size={pillSize} />
                  </div>
                  <ExpenseLogMeta txn={txn} density={density} isSplit />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingId(txn.id)}
                  className={`w-full rounded-xl border border-slate-800 bg-slate-950/50 text-left text-sm text-slate-100 transition hover:border-blue-500/40 hover:bg-slate-900/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 touch-manipulation ${cardPad}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <span className="min-w-0 flex-1 font-semibold leading-snug text-slate-100">
                      {txn.title || txn.categoryLabel}
                    </span>
                    <AmountPill cents={txn.amountCents} size={pillSize} />
                  </div>
                  <ExpenseLogMeta txn={txn} density={density} isSplit={false} />
                </button>
              )}
            </div>
          ))
        )}
      </div>
      {editing ? (
        <EditExpenseModal
          key={editing.id}
          entry={editing}
          accounts={accounts}
          categories={categories}
          onClose={() => setEditingId(null)}
        />
      ) : null}
    </>
  );
}
