"use client";

import { isActionFailure } from "@/lib/action-result";
import { useActionState, useEffect, useId, useMemo, useRef, useState } from "react";
import { COMPACT_LIST_MAX_HEIGHT_CLASS } from "@/lib/dashboard-layout/display";
import type { ListHeight } from "@/lib/dashboard-layout/schema";
import { useRouter } from "next/navigation";
import { deleteIncomeTransactionAction, updateIncomeAction } from "@/app/actions";
import { InlineTags } from "@/components/meta-chip";
import {
  CategoryDot,
  MetaParts,
  TransactionDay,
  TransactionDayHeader,
  TransactionMetaLine,
  transactionRowClass,
} from "@/components/transaction-rows";
import { groupTransactionsByDay, homeCurrencyDayTotal } from "@/lib/transaction-day-groups";
import { TagInput } from "@/components/tag-input";
import { useTagOptions } from "@/components/transaction-rules-context";
import { MarkAsTransferSection } from "@/components/transfer-log";
import { useConfirm } from "@/components/settings/dialog";
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
  /** Tag names, sorted. */
  tags: string[];
  /** The account's currency when it is not the home one: shown in it, and left out of totals. */
  currency?: string | null;
};

type UpdateState = { ok: true } | { ok: false; error: string | null };

type DeleteState = { ok: true } | { ok: false; error: string | null };

type IncomeLogDensity = "expanded" | "compact";


function incomeHeading(entry: IncomeLogEntry) {
  return entry.title?.trim() || entry.sourceLabel;
}

function IncomeLogRow({
  entry,
  density,
  onEdit,
}: {
  entry: IncomeLogEntry;
  density: IncomeLogDensity;
  onEdit: (id: string) => void;
}) {
  const hasTitle = Boolean(entry.title?.trim());
  const fullTitle = [
    hasTitle ? entry.sourceLabel : null,
    entry.accountLabel,
    entry.dateDisplay,
    entry.note,
    entry.tags.length > 0 ? entry.tags.map((tag) => `#${tag}`).join(" ") : null,
    entry.verification ? verificationTooltip(entry.verification) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <button type="button" onClick={() => onEdit(entry.id)} className={transactionRowClass(density, "emerald")}>
      <CategoryDot categoryIds={[entry.categoryId]} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium leading-snug text-slate-100">{incomeHeading(entry)}</span>
        <TransactionMetaLine density={density} title={fullTitle}>
          <MetaParts parts={[hasTitle ? entry.sourceLabel : null, entry.accountLabel, entry.note]} />
          <InlineTags tags={entry.tags} />
        </TransactionMetaLine>
        {/* `title` never fires on touch, so touch screens get the badge's detail spelled out. */}
        {entry.verification ? (
          <span className="hidden text-[11px] leading-snug text-slate-500 pointer-coarse:block">
            {verificationTooltip(entry.verification)}
          </span>
        ) : null}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5 text-right">
        <span data-testid="income-amount" className="font-semibold tabular-nums text-emerald-300">
          +{formatCurrency(entry.amountCents, entry.currency ?? undefined)}
        </span>
        {entry.verification ? <VerifiedBadge info={entry.verification} variant="text" /> : null}
      </span>
    </button>
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
  const [showTags, setShowTags] = useState(entry.tags.length > 0);
  const tagOptions = useTagOptions();

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

  const confirm = useConfirm();
  const deleteFormRef = useRef<HTMLFormElement>(null);
  const confirmOpen = confirm.dialog !== null;

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
    // While the delete confirmation is open, Escape belongs to it, not to this modal.
    if (confirmOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, confirmOpen]);

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
            <button
              type="button"
              onClick={() => setShowTags((v) => !v)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                showTags
                  ? "border-blue-500/40 bg-blue-500/15 text-blue-100"
                  : "border-slate-700/80 bg-slate-950/50 text-slate-300 hover:bg-slate-900/70"
              }`}
            >
              Tags
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
          {showTags ? (
            <div className={spanFullSm}>
              <TagInput defaultTags={entry.tags} suggestions={tagOptions.names} />
            </div>
          ) : (
            <input type="hidden" name="tags" value="" />
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

        <MarkAsTransferSection transactionId={entry.id} kind="income" onDone={onClose} />

        <div className={`${spanFullSm} mt-4 border-t border-slate-800/90 pt-4`}>
          <p className="mb-2 text-xs leading-relaxed text-slate-500">
            Remove this deposit from your income list and dashboard totals. This cannot be undone.
          </p>
          <form ref={deleteFormRef} action={deleteFormAction}>
            <input type="hidden" name="transactionId" value={entry.id} />
            {deleteState.ok === false && deleteState.error ? (
              <p className="mb-2 text-sm text-red-300">{deleteState.error}</p>
            ) : null}
            <button
              type="button"
              disabled={isPending || deletePending}
              className="w-full touch-manipulation rounded-xl border border-red-800/70 bg-red-950/40 px-3 py-2.5 text-sm font-medium text-red-200 transition hover:border-red-700/80 hover:bg-red-950/60 sm:w-auto"
              onClick={async () => {
                const ok = await confirm.ask({
                  title: "Delete this income entry?",
                  body: "It comes off your income list and dashboard totals. This cannot be undone.",
                  confirmLabel: "Delete",
                  danger: true,
                });
                if (ok) deleteFormRef.current?.requestSubmit();
              }}
            >
              {deletePending ? "Deleting…" : "Delete income"}
            </button>
          </form>
          {confirm.dialog}
        </div>
      </div>
    </div>
  );
}

export function IncomeLogPanel({
  entries,
  accounts,
  categories,
  density = "expanded",
  maxHeight = "default",
}: {
  entries: IncomeLogEntry[];
  accounts: Option[];
  categories: Option[];
  /** Card settings on the dashboard layout; see the note on ExpenseLogPanel. */
  density?: IncomeLogDensity;
  maxHeight?: ListHeight;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = editingId ? entries.find((e) => e.id === editingId) : null;

  const days = useMemo(() => groupTransactionsByDay(entries, (entry) => entry), [entries]);

  return (
    <>
      <div className={`${COMPACT_LIST_MAX_HEIGHT_CLASS[maxHeight]} min-h-0 overflow-y-auto overflow-x-hidden pr-1 [-webkit-overflow-scrolling:touch]`}>
        {entries.length === 0 ? (
          <p className="text-sm text-slate-400">No income in this period.</p>
        ) : (
          days.map((day) => {
            const total = homeCurrencyDayTotal(day.items);
            return (
              <section key={day.dateYmd} aria-label={day.dateDisplay}>
                <TransactionDayHeader
                  dateDisplay={day.dateDisplay}
                  total={total === null ? null : `+${formatCurrency(total)}`}
                />
                <TransactionDay>
                  {day.items.map((entry) => (
                    <IncomeLogRow key={entry.id} entry={entry} density={density} onEdit={setEditingId} />
                  ))}
                </TransactionDay>
              </section>
            );
          })
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
