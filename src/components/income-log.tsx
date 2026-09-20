"use client";

import { isActionFailure } from "@/lib/action-result";
import { useActionState, useEffect, useId, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { deleteIncomeTransactionAction, updateIncomeAction } from "@/app/actions";
import { MetaChip } from "@/components/meta-chip";
import { VerifiedBadge, verificationTooltip, type VerificationInfo } from "@/components/verified-badge";
import { formatCurrency } from "@/lib/money";
import { MOBILE_OVERLAY_ROOT_Z_CLASS } from "@/lib/mobile-z-index";
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

export type IncomeLogEntry = {
  id: string;
  amountCents: number;
  dateYmd: string;
  dateDisplay: string;
  title: string | null;
  note: string | null;
  accountId: string | null;
  categoryId: string;
  /** Income category name (source). */
  sourceLabel: string;
  accountLabel: string;
  /** Set once the entry has been confirmed against a bank record. */
  verification: VerificationInfo | null;
};

type UpdateState = { ok: true } | { ok: false; error: string | null };

type DeleteState = { ok: true } | { ok: false; error: string | null };

type IncomeLogDensity = "expanded" | "compact";

const INCOME_LOG_DENSITY_KEY = "finance-tracker-income-log-density";

const incomeLogDensityListeners = new Set<() => void>();

function subscribeIncomeLogDensity(listener: () => void) {
  incomeLogDensityListeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === INCOME_LOG_DENSITY_KEY || e.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    incomeLogDensityListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function emitIncomeLogDensity() {
  incomeLogDensityListeners.forEach((l) => l());
}

function getIncomeLogDensitySnapshot(): IncomeLogDensity {
  if (typeof window === "undefined") return "expanded";
  return window.localStorage.getItem(INCOME_LOG_DENSITY_KEY) === "compact" ? "compact" : "expanded";
}

function getIncomeLogDensityServerSnapshot(): IncomeLogDensity {
  return "expanded";
}

function persistIncomeLogDensity(next: IncomeLogDensity) {
  try {
    window.localStorage.setItem(INCOME_LOG_DENSITY_KEY, next);
  } catch {
    /* private mode */
  }
  emitIncomeLogDensity();
}

function ReceivedPill({ cents, size = "default" }: { cents: number; size?: "default" | "compact" }) {
  const sizeClass =
    size === "compact"
      ? "px-2 py-0.5 text-xs font-semibold tabular-nums"
      : "px-2.5 py-1 text-sm font-semibold tabular-nums";
  return (
    <span
      className={`shrink-0 rounded-full border border-emerald-500/40 bg-emerald-500/15 text-emerald-100 shadow-sm ring-1 ring-emerald-500/15 ${sizeClass}`}
    >
      Received {formatCurrency(cents)}
    </span>
  );
}

function IncomeChipRow({ entry }: { entry: IncomeLogEntry }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      <MetaChip label="Account">{entry.accountLabel}</MetaChip>
      {entry.verification ? <VerifiedBadge info={entry.verification} /> : null}
      <MetaChip label="Date">{entry.dateDisplay}</MetaChip>
      {entry.note ? <MetaChip label="Note">{entry.note}</MetaChip> : null}
    </div>
  );
}

function IncomeLogMeta({ entry, density }: { entry: IncomeLogEntry; density: IncomeLogDensity }) {
  if (density === "compact") {
    const parts: string[] = [];
    if (entry.title) parts.push(entry.title);
    parts.push(entry.sourceLabel, entry.accountLabel, entry.dateDisplay);
    if (entry.note) parts.push(entry.note);
    const line = parts.join(" · ");
    return (
      <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-slate-400 sm:text-xs" title={line}>
        {line}
      </p>
    );
  }

  return <IncomeChipRow entry={entry} />;
}

function IncomeLogMobileCard({
  entry,
  pillSize,
}: {
  entry: IncomeLogEntry;
  pillSize: "default" | "compact";
}) {
  return (
    <div className="flex flex-col gap-2 sm:hidden">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-400/85">Income source</p>
          <span className="mt-0.5 block text-base font-semibold leading-snug text-slate-50">{entry.sourceLabel}</span>
          {entry.title ? (
            <span className="mt-1 block text-sm leading-snug text-slate-300">{entry.title}</span>
          ) : null}
        </div>
        <ReceivedPill cents={entry.amountCents} size={pillSize} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <MetaChip label="Account">{entry.accountLabel}</MetaChip>
        <MetaChip label="Date">{entry.dateDisplay}</MetaChip>
        {entry.verification ? <VerifiedBadge info={entry.verification} /> : null}
      </div>
      {/* `title` never fires on touch, so the badge's detail is spelled out on the card. */}
      {entry.verification ? (
        <p className="text-xs leading-snug text-slate-500">{verificationTooltip(entry.verification)}</p>
      ) : null}
      {entry.note ? <p className="text-xs leading-snug text-slate-400">{entry.note}</p> : null}
    </div>
  );
}

function IncomeLogDensityToggle({
  density,
  onChange,
}: {
  density: IncomeLogDensity;
  onChange: (next: IncomeLogDensity) => void;
}) {
  const expanded = density === "expanded";
  return (
    <div className="flex min-w-0 items-center gap-2 sm:gap-2.5">
      <span className={`text-xs ${expanded ? "text-slate-500" : "font-medium text-slate-200"}`}>Compact</span>
      <button
        type="button"
        role="switch"
        aria-checked={expanded}
        aria-label="Income list layout: compact or expanded with chips"
        title={expanded ? "Expanded: detail chips" : "Compact: dense summary"}
        onClick={() => onChange(expanded ? "compact" : "expanded")}
        className="relative h-7 w-11 shrink-0 rounded-full border border-slate-600 bg-slate-800 transition-colors hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 touch-manipulation"
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

function EditIncomeModal({
  entry,
  accounts,
  categories,
  onClose,
}: {
  entry: IncomeLogEntry;
  accounts: Option[];
  categories: Option[];
  onClose: () => void;
}) {
  const router = useRouter();
  const fieldIds = useId();
  const [showTitle, setShowTitle] = useState(Boolean(entry.title));
  const [showNote, setShowNote] = useState(Boolean(entry.note));

  const [state, formAction, isPending] = useActionState(
    async (_prev: UpdateState, formData: FormData): Promise<UpdateState> => {
      try {
        const result = await updateIncomeAction(formData);
        if (isActionFailure(result)) return { ok: false, error: result.error };
        return { ok: true };
      } catch (e) {
        const message = e instanceof Error ? e.message : "Could not save changes.";
        return { ok: false, error: message };
      }
    },
    { ok: false, error: null },
  );

  const [deleteState, deleteFormAction, deletePending] = useActionState(
    async (_prev: DeleteState, formData: FormData): Promise<DeleteState> => {
      try {
        const result = await deleteIncomeTransactionAction(formData);
        if (isActionFailure(result)) return { ok: false, error: result.error };
        return { ok: true };
      } catch (e) {
        const message = e instanceof Error ? e.message : "Could not delete.";
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
    if (deleteState.ok) {
      onClose();
      router.refresh();
    }
  }, [deleteState, onClose, router]);

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
      className={`fixed inset-0 ${MOBILE_OVERLAY_ROOT_Z_CLASS} flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4`}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-income-title"
        className="max-h-[min(90dvh,40rem)] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-slate-700 border-b-0 bg-slate-900 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 shadow-2xl sm:rounded-2xl sm:border-b sm:px-5 sm:pb-5 sm:pt-5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 id="edit-income-title" className="mb-1 text-lg font-semibold text-slate-100">
          Edit income
        </h3>
        <p className="mb-4 text-xs leading-relaxed text-slate-500">
          Update source (category), deposit account, amount, and dates. Totals on the dashboard refresh after you save.
        </p>
        <form action={formAction} className={formGridResponsive}>
          <input type="hidden" name="transactionId" value={entry.id} />
          <LabeledField label="Account" hint="Account that received this income.">
            <select
              id={`${fieldIds}-account`}
              name="accountId"
              className={selectClass}
              defaultValue={entry.accountId ?? ""}
              required
            >
              {entry.accountId ? null : (
                <option value="" disabled>
                  Choose account (previous account was removed)
                </option>
              )}
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </LabeledField>
          <LabeledField label="Source" hint="Income category (salary, interest, reimbursement, etc.).">
            <select id={`${fieldIds}-category`} name="categoryId" className={selectClass} defaultValue={entry.categoryId}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </LabeledField>
          <div className={`${spanFullSm} flex flex-wrap gap-2`}>
            <button
              type="button"
              onClick={() => setShowTitle((v) => !v)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                showTitle
                  ? "border-blue-500/40 bg-blue-500/15 text-blue-100"
                  : "border-slate-700/80 bg-slate-950/50 text-slate-300 hover:bg-slate-900/70"
              }`}
            >
              Title
            </button>
            <button
              type="button"
              onClick={() => setShowNote((v) => !v)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                showNote
                  ? "border-blue-500/40 bg-blue-500/15 text-blue-100"
                  : "border-slate-700/80 bg-slate-950/50 text-slate-300 hover:bg-slate-900/70"
              }`}
            >
              Note
            </button>
          </div>
          <CurrencyAmountInput
            name="amount"
            label="Amount"
            placeholder="0.00"
            defaultValue={amountDollars}
            required
          />
          <DateField
            name="date"
            label="Income date"
            hint="The date you assign to this deposit."
            defaultValue={entry.dateYmd}
            required
          />
          {showTitle ? (
            <LabeledField label="Title" hint="Optional label shown under the source (max 120 characters)." className={spanFullSm}>
              <textarea
                name="title"
                rows={2}
                maxLength={120}
                className={textAreaClass}
                placeholder="e.g. Paycheque, freelance invoice"
                defaultValue={entry.title ?? ""}
              />
            </LabeledField>
          ) : (
            <input type="hidden" name="title" value="" />
          )}
          {showNote ? (
            <LabeledField label="Note" hint="Optional details (max 250 characters)." className={spanFullSm}>
              <textarea
                name="note"
                rows={4}
                maxLength={250}
                className={textAreaClass}
                placeholder="Additional context"
                defaultValue={entry.note ?? ""}
              />
            </LabeledField>
          ) : (
            <input type="hidden" name="note" value="" />
          )}
          {state.ok === false && state.error ? (
            <p className={`${spanFullSm} text-sm text-red-300`}>{state.error}</p>
          ) : null}
          <div className={`${spanFullSm} flex flex-col gap-2 pt-1 sm:flex-row sm:flex-wrap`}>
            <button
              type="submit"
              disabled={isPending || deletePending}
              className={`w-full ${primaryBtnClass} py-2.5 sm:w-auto sm:py-2`}
            >
              {isPending ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              disabled={isPending || deletePending}
              className={`w-full ${secondaryBtnClass} py-2.5 sm:w-auto sm:py-2`}
              onClick={onClose}
            >
              Cancel
            </button>
          </div>
        </form>

        <div className={`${spanFullSm} mt-4 border-t border-slate-800/90 pt-4`}>
          <p className="mb-2 text-xs leading-relaxed text-slate-500">
            Remove this deposit from your income list and dashboard totals. This cannot be undone.
          </p>
          <form action={deleteFormAction}>
            <input type="hidden" name="transactionId" value={entry.id} />
            {deleteState.ok === false && deleteState.error ? (
              <p className="mb-2 text-sm text-red-300">{deleteState.error}</p>
            ) : null}
            <button
              type="submit"
              disabled={isPending || deletePending}
              className="w-full touch-manipulation rounded-xl border border-red-800/70 bg-red-950/40 px-3 py-2.5 text-sm font-medium text-red-200 transition hover:border-red-700/80 hover:bg-red-950/60 sm:w-auto"
              onClick={(e) => {
                if (
                  !window.confirm(
                    "Delete this income entry permanently? This cannot be undone.",
                  )
                ) {
                  e.preventDefault();
                }
              }}
            >
              {deletePending ? "Deleting…" : "Delete income"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export function IncomeLogPanel({
  entries,
  accounts,
  categories,
}: {
  entries: IncomeLogEntry[];
  accounts: Option[];
  categories: Option[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const density = useSyncExternalStore(
    subscribeIncomeLogDensity,
    getIncomeLogDensitySnapshot,
    getIncomeLogDensityServerSnapshot,
  );
  const editing = editingId ? entries.find((e) => e.id === editingId) : null;

  const cardPad = density === "compact" ? "p-2" : "p-2.5";
  const pillSize = density === "compact" ? "compact" : "default";

  return (
    <>
      {entries.length > 0 ? (
        <div className="mb-2 hidden justify-end sm:flex">
          <IncomeLogDensityToggle density={density} onChange={persistIncomeLogDensity} />
        </div>
      ) : null}
      <div className="max-h-[min(56vh,28rem)] min-h-0 space-y-2 overflow-y-auto overflow-x-hidden pr-1 [-webkit-overflow-scrolling:touch]">
        {entries.length === 0 ? (
          <p className="text-sm text-slate-400">No income in this period.</p>
        ) : (
          entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setEditingId(entry.id)}
              className={`w-full rounded-xl border border-slate-800 bg-slate-950/50 text-left text-sm text-slate-100 transition hover:border-emerald-500/35 hover:bg-slate-900/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 touch-manipulation ${cardPad}`}
            >
              <IncomeLogMobileCard entry={entry} pillSize={pillSize} />
              <div className="hidden sm:block">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-400/85">Income source</p>
                    <span className="mt-0.5 block break-words font-semibold leading-snug text-slate-50">{entry.sourceLabel}</span>
                    {entry.title ? (
                      <span className="mt-1 block break-words text-sm leading-snug text-slate-300">{entry.title}</span>
                    ) : null}
                    <IncomeLogMeta entry={entry} density={density} />
                  </div>
                  <ReceivedPill cents={entry.amountCents} size={pillSize} />
                </div>
              </div>
            </button>
          ))
        )}
      </div>
      {editing ? (
        <EditIncomeModal
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
