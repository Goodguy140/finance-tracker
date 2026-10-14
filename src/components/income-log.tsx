"use client";

import { isActionFailure } from "@/lib/action-result";
import { useActionState, useEffect, useId, useMemo, useState } from "react";
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
import { EditSheet, EditSheetFooter, editSheetDeleteBtnClass } from "@/components/edit-sheet";
import { VerifiedBadge, verificationTooltip, type VerificationInfo } from "@/components/verified-badge";
import { formatCurrency } from "@/lib/money";
import {
  CurrencyAmountInput,
  DateField,
  FieldHintModeProvider,
  LabeledField,
  formGridResponsive,
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

  const formId = `${fieldIds}-form`;

  return (
    <EditSheet
      titleId="edit-income-title"
      title="Edit income"
      onClose={onClose}
      footer={
        <EditSheetFooter
          formId={formId}
          error={state.ok === false && state.error ? state.error : null}
          isPending={isPending}
          deletePending={deletePending}
          onClose={onClose}
          deleteControl={
          <form action={deleteFormAction}>
            <input type="hidden" name="transactionId" value={entry.id} />
            {deleteState.ok === false && deleteState.error ? (
              <p className="mb-2 text-sm text-red-300">{deleteState.error}</p>
            ) : null}
            <button
              type="submit"
              disabled={isPending || deletePending}
              className={editSheetDeleteBtnClass}
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
          }
        />
      }
    >
        <FieldHintModeProvider mode="info">
        <form id={formId} action={formAction} className={formGridResponsive}>
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
        </form>
        </FieldHintModeProvider>

        <MarkAsTransferSection transactionId={entry.id} kind="income" onDone={onClose} />
    </EditSheet>
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
