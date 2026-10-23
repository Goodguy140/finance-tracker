"use client";

import { useOpenRequest } from "@/lib/search/dashboard-requests";
import { isActionFailure } from "@/lib/action-result";
import { useActionState, useEffect, useId, useRef, useMemo, useState } from "react";
import { LIST_MAX_HEIGHT_CLASS } from "@/lib/dashboard-layout/display";
import type { ListHeight } from "@/lib/dashboard-layout/schema";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { deleteExpenseTransactionAction, updateExpenseAction } from "@/app/actions";
import { InlineTags } from "@/components/meta-chip";
import { TagInput } from "@/components/tag-input";
import { useTagOptions } from "@/components/transaction-rules-context";
import type { TagOption } from "@/lib/tags";
import { MarkAsTransferSection } from "@/components/transfer-log";
import { EditSheet, EditSheetFooter, editSheetDeleteBtnClass } from "@/components/edit-sheet";
import { useConfirm } from "@/components/settings/dialog";
import { VerifiedBadge, verificationTooltip, type VerificationInfo } from "@/components/verified-badge";
import {
  CategoryDot,
  MetaParts,
  TransactionDay,
  TransactionDayHeader,
  TransactionMetaLine,
  transactionRowClass,
} from "@/components/transaction-rows";
import { groupTransactionsByDay, homeCurrencyDayTotal } from "@/lib/transaction-day-groups";
import {
  type ExpenseGroupSummary,
  groupExpenseLogEntries,
  summarizeExpenseGroup,
} from "@/lib/expense-log-grouping";
import {
  CurrencyAmountInput,
  DateField,
  ExpenseTitleAndCategoryFields,
  type ExpenseTitleSuggestion,
  FieldHintModeProvider,
  LabeledField,
  formGridResponsive,
  inputClass,
  selectClass,
  spanFullSm,
  textAreaClass,
} from "@/components/forms";
import { expenseLogMatchesQuery } from "@/lib/expense-title-suggestions";
import { formatCurrency } from "@/lib/money";
import { OWED_SHARE_NAME_MAX, OWED_SHARES_FIELD, owedTotalCents } from "@/lib/owed-shares";
import { SPLIT_LINES_FIELD } from "@/lib/split-lines";

type Option = { id: string; name: string };

export type ExpenseLogEntry = {
  id: string;
  amountCents: number;
  /** Gross / receipt total before credits; null when using a simple amount only. */
  preCreditCents: number | null;
  /** Credits or discounts in positive cents. */
  creditCents: number | null;
  /** JSON array of per-credit cents to preserve separate credit lines across edits. */
  creditBreakdownJson: string | null;
  dateYmd: string;
  dateDisplay: string;
  postedDateYmd: string | null;
  postedDateDisplay: string | null;
  title: string | null;
  note: string | null;
  accountId: string | null;
  categoryId: string;
  accountLabel: string;
  categoryLabel: string;
  isSplit: boolean;
  /** A split expense's lines, one per category; empty for any other expense. */
  splitLines: ExpenseSplitLine[];
  /** Set once the transaction has been confirmed against a bank record. */
  verification: VerificationInfo | null;
  /** Tag names, sorted. */
  tags: string[];
  /** What others owe back on this expense; already taken out of `amountCents`. */
  owedShares: ExpenseOwedShare[];
  /** The account's currency when it is not the home one: shown in it, and left out of totals. */
  currency?: string | null;
};

export type ExpenseOwedShare = { id: string; name: string; amountCents: number; paid: boolean };

export type ExpenseSplitLine = { id: string; categoryId: string; categoryLabel: string; amountCents: number };

type SplitLineDraft = { key: string; categoryId: string; amount: string };

type OwedRowDraft = { key: string; id: string | null; name: string; amount: string; paid: boolean };

type UpdateState = { ok: true } | { ok: false; error: string | null };

type DeleteState = { ok: true } | { ok: false; error: string | null };

type ExpenseLogDensity = "expanded" | "compact";


function showReceiptBreakdown(txn: ExpenseLogEntry) {
  if (txn.preCreditCents == null || txn.preCreditCents <= 0) return false;
  if ((txn.creditCents ?? 0) > 0) return true;
  return txn.preCreditCents !== txn.amountCents;
}

/** The figure on the right of a row: what the expense cost you, with no label. */
function ExpenseAmount({ cents, currency }: { cents: number; currency?: string }) {
  // A negative expense is a refund or credit: it gives money back, so it reads as green.
  return (
    <span
      data-testid="expense-amount"
      className={`font-semibold tabular-nums ${cents < 0 ? "text-emerald-300" : "text-slate-100"}`}
    >
      {formatCurrency(cents, currency)}
    </span>
  );
}

function ReceiptBreakdown({
  preCreditCents,
  creditCents,
  currency,
}: {
  preCreditCents: number;
  creditCents: number;
  currency?: string;
}) {
  return (
    <p className="text-[11px] leading-tight tabular-nums text-slate-400">
      Total {formatCurrency(preCreditCents, currency)}
      {creditCents > 0 ? (
        <span className="text-emerald-400/95"> · Credits {formatCurrency(-creditCents, currency)}</span>
      ) : null}
    </p>
  );
}

function ExpenseAmountBlock({ txn }: { txn: ExpenseLogEntry }) {
  const owedCents = owedTotalCents(txn.owedShares);
  const currency = txn.currency ?? undefined;
  return (
    <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
      <ExpenseAmount cents={txn.amountCents} currency={currency} />
      {owedCents > 0 ? (
        <p className="text-[11px] leading-tight tabular-nums text-amber-300/95" data-testid="expense-owed-breakdown">
          <span className="block text-slate-400">Paid {formatCurrency(txn.amountCents + owedCents, currency)}</span>
          <span className="block">{formatCurrency(owedCents, currency)} owed</span>
        </p>
      ) : null}
      {showReceiptBreakdown(txn) ? (
        <ReceiptBreakdown preCreditCents={txn.preCreditCents!} creditCents={txn.creditCents ?? 0} currency={currency} />
      ) : null}
      {/* The verification mark sits under the amount: it is a statement about this figure. */}
      {txn.verification ? <VerifiedBadge info={txn.verification} variant="text" /> : null}
    </div>
  );
}

function expenseLogHeading(txn: ExpenseLogEntry) {
  return txn.title?.trim() || txn.categoryLabel;
}

function splitLinesSummary(txn: ExpenseLogEntry) {
  return txn.splitLines.map((line) => `${line.categoryLabel} ${formatCurrency(line.amountCents)}`).join(" · ");
}

function expenseDotCategories(txn: ExpenseLogEntry) {
  return txn.isSplit && txn.splitLines.length > 0 ? txn.splitLines.map((line) => line.categoryId) : [txn.categoryId];
}

/**
 * Category (when the title is not already the category), account, posted date and note on
 * one muted line, then tags. The transaction date is the day header above the row.
 */
function ExpenseRowMeta({ txn, density }: { txn: ExpenseLogEntry; density: ExpenseLogDensity }) {
  const hasTitle = Boolean(txn.title?.trim());
  const split = txn.isSplit ? (
    <>
      <span className="font-medium text-amber-300/90">Split</span> {splitLinesSummary(txn)}
    </>
  ) : null;
  const parts = [
    split ?? (hasTitle ? txn.categoryLabel : null),
    txn.accountLabel,
    txn.postedDateDisplay ? `Posted ${txn.postedDateDisplay}` : null,
    txn.note,
  ];
  const fullTitle = [
    txn.isSplit ? `Split: ${splitLinesSummary(txn)}` : hasTitle ? txn.categoryLabel : null,
    txn.accountLabel,
    txn.dateDisplay,
    txn.postedDateDisplay ? `posted ${txn.postedDateDisplay}` : null,
    txn.note,
    txn.tags.length > 0 ? txn.tags.map((tag) => `#${tag}`).join(" ") : null,
    txn.verification ? verificationTooltip(txn.verification) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      <TransactionMetaLine density={density} title={fullTitle}>
        <MetaParts parts={parts} />
        <InlineTags tags={txn.tags} />
      </TransactionMetaLine>
      {/* The badge's detail lives in `title`, which never fires on touch, so touch screens
          get the sentence spelled out. */}
      {txn.verification ? (
        <span className="hidden text-[11px] leading-snug text-slate-500 pointer-coarse:block">
          {verificationTooltip(txn.verification)}
        </span>
      ) : null}
    </>
  );
}

function EditExpenseModal({
  entry,
  accounts,
  categories,
  titleSuggestions,
  onClose,
}: {
  entry: ExpenseLogEntry;
  accounts: Option[];
  categories: Option[];
  titleSuggestions: ExpenseTitleSuggestion[];
  onClose: () => void;
}) {
  function parseCreditRowsFromJson(raw: string | null, fallbackCreditDollars: string) {
    if (!raw) return [fallbackCreditDollars !== "" ? fallbackCreditDollars : ""];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [fallbackCreditDollars !== "" ? fallbackCreditDollars : ""];
      const rows = parsed
        .map((v) => Number(v))
        .filter((v) => Number.isFinite(v) && v > 0)
        .map((cents) => (cents / 100).toFixed(2));
      return rows.length > 0 ? rows : [fallbackCreditDollars !== "" ? fallbackCreditDollars : ""];
    } catch {
      return [fallbackCreditDollars !== "" ? fallbackCreditDollars : ""];
    }
  }

  const router = useRouter();
  const fieldIds = useId();
  const isSplit = entry.isSplit;
  // A split's lines add up to one plain amount, so it is edited without a receipt breakdown.
  const [receiptBreakdown, setReceiptBreakdown] = useState(
    !isSplit && entry.preCreditCents != null && entry.preCreditCents > 0,
  );
  const [showPostedDate, setShowPostedDate] = useState(entry.postedDateYmd != null);
  const [showNote, setShowNote] = useState(Boolean(entry.note));
  const [showTags, setShowTags] = useState(entry.tags.length > 0);
  const tagOptions = useTagOptions();

  const [state, formAction, isPending] = useActionState(
    async (_prev: UpdateState, formData: FormData): Promise<UpdateState> => {
      try {
        const result = await updateExpenseAction(formData);
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
        const result = await deleteExpenseTransactionAction(formData);
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

  // The amount field is what the user paid; what others owe comes out of it on save.
  const initialOwedCents = owedTotalCents(entry.owedShares);
  const amountDollars = ((entry.amountCents + initialOwedCents) / 100).toFixed(2);
  const [owedRows, setOwedRows] = useState<OwedRowDraft[]>(() =>
    entry.owedShares.map((share) => ({
      key: share.id,
      id: share.id,
      name: share.name,
      amount: (share.amountCents / 100).toFixed(2),
      paid: share.paid,
    })),
  );
  const owedSum = owedRows.reduce((sum, row) => {
    const n = Number(row.amount);
    return Number.isFinite(n) && n > 0 ? sum + n : sum;
  }, 0);
  function updateOwedRow(key: string, patch: Partial<OwedRowDraft>) {
    setOwedRows((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }
  function addOwedRow() {
    setOwedRows((rows) => [...rows, { key: `new-${Date.now()}-${rows.length}`, id: null, name: "", amount: "", paid: false }]);
  }
  const [splitRows, setSplitRows] = useState<SplitLineDraft[]>(() =>
    entry.splitLines.map((line) => ({
      key: line.id,
      categoryId: line.categoryId,
      amount: (line.amountCents / 100).toFixed(2),
    })),
  );
  // A line's category may be one the pickers no longer offer; keep it choosable.
  const splitCategoryOptions = [
    ...categories,
    ...entry.splitLines
      .filter((line) => !categories.some((c) => c.id === line.categoryId))
      .map((line) => ({ id: line.categoryId, name: line.categoryLabel })),
  ].filter((c, i, all) => all.findIndex((o) => o.id === c.id) === i);
  function updateSplitRow(key: string, patch: Partial<SplitLineDraft>) {
    setSplitRows((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }
  function addSplitRow() {
    setSplitRows((rows) => [
      ...rows,
      { key: `new-${Date.now()}-${rows.length}`, categoryId: categories[0]?.id ?? "", amount: "" },
    ]);
  }

  const preDollarsDefault =
    entry.preCreditCents != null ? (entry.preCreditCents / 100).toFixed(2) : amountDollars;
  const creditDollarsDefault =
    entry.creditCents != null ? (entry.creditCents / 100).toFixed(2) : "";
  const [amountValue, setAmountValue] = useState(amountDollars);
  // Compared in cents, so float error never reads as a mismatch.
  const splitSumCents = splitRows.reduce((sum, row) => {
    const n = Number(row.amount);
    return Number.isFinite(n) ? sum + Math.round(n * 100) : sum;
  }, 0);
  const amountNumber = Number(amountValue);
  const splitLeftCents =
    amountValue.trim() !== "" && Number.isFinite(amountNumber) ? Math.round(amountNumber * 100) - splitSumCents : null;
  const [preCreditValue, setPreCreditValue] = useState(preDollarsDefault);
  const [creditRows, setCreditRows] = useState<string[]>(
    parseCreditRowsFromJson(entry.creditBreakdownJson, creditDollarsDefault),
  );
  const creditSum = sumCredits(creditRows);
  const preCreditNumber = Number(preCreditValue);
  const hasValidPreCredit = Number.isFinite(preCreditNumber);
  const netPaidPreview = hasValidPreCredit ? preCreditNumber - creditSum : null;
  const paidPreview = receiptBreakdown ? netPaidPreview : Number(amountValue);
  const ownPartPreview = paidPreview !== null && Number.isFinite(paidPreview) ? paidPreview - owedSum : null;

  function sumCredits(rows: string[]) {
    return rows.reduce((sum, row) => {
      const n = Number(row);
      return Number.isFinite(n) && n >= 0 ? sum + n : sum;
    }, 0);
  }

  function toggleReceiptBreakdown() {
    if (!receiptBreakdown) {
      if (preCreditValue.trim() === "" && amountValue.trim() !== "") {
        setPreCreditValue(amountValue);
      }
      setReceiptBreakdown(true);
      return;
    }

    const pre = Number(preCreditValue);
    if (Number.isFinite(pre) && pre > 0) {
      const net = pre - sumCredits(creditRows);
      if (Number.isFinite(net) && net !== 0) {
        setAmountValue(String(Number(net.toFixed(2))));
      } else {
        setAmountValue(String(Number(pre.toFixed(2))));
      }
    }
    setReceiptBreakdown(false);
  }

  const formId = `${fieldIds}-form`;

  return (
    <EditSheet
      titleId="edit-expense-title"
      title="Edit expense"
      onClose={onClose}
      footer={
        <EditSheetFooter
          formId={formId}
          error={state.ok === false && state.error ? state.error : null}
          isPending={isPending}
          deletePending={deletePending}
          onClose={onClose}
          deleteControl={
          <form ref={deleteFormRef} action={deleteFormAction}>
            <input type="hidden" name="transactionId" value={entry.id} />
            {deleteState.ok === false && deleteState.error ? (
              <p className="mb-2 text-sm text-red-300">{deleteState.error}</p>
            ) : null}
            <button
              type="button"
              disabled={isPending || deletePending}
              className={editSheetDeleteBtnClass}
              onClick={async () => {
                const ok = await confirm.ask({
                  title: "Delete this expense?",
                  body: "It comes off your log and category totals. This cannot be undone.",
                  confirmLabel: "Delete",
                  danger: true,
                });
                if (ok) deleteFormRef.current?.requestSubmit();
              }}
            >
              {deletePending ? "Deleting…" : "Delete expense"}
            </button>
          </form>
          }
        />
      }
    >
        <FieldHintModeProvider mode="info">
        <form id={formId} action={formAction} className={formGridResponsive}>
          <input type="hidden" name="transactionId" value={entry.id} />
          <div className={spanFullSm}>
          <ExpenseTitleAndCategoryFields
            fieldIds={fieldIds}
            expenseCategories={categories}
            titleSuggestions={titleSuggestions}
            defaultTitle={entry.title ?? ""}
            defaultCategoryId={entry.categoryId}
            accounts={accounts}
            accountSelectDefault={entry.accountId ?? ""}
            accountRemovedFallback={!entry.accountId}
            hideCategory={isSplit}
          />
          </div>

          <div className={`${spanFullSm} flex flex-wrap gap-2`}>
            <button
              type="button"
              onClick={() => setShowPostedDate((v) => !v)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                showPostedDate
                  ? "border-blue-500/40 bg-blue-500/15 text-blue-100"
                  : "border-slate-700/80 bg-slate-950/50 text-slate-300 hover:bg-slate-900/70"
              }`}
            >
              Posted date
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
            {isSplit ? null : (
              <>
            <button
              type="button"
              onClick={toggleReceiptBreakdown}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                receiptBreakdown
                  ? "border-emerald-500/45 bg-emerald-500/15 text-emerald-100"
                  : "border-slate-700/80 bg-slate-950/50 text-slate-300 hover:bg-slate-900/70"
              }`}
            >
              Receipt breakdown
            </button>
            <button
              type="button"
              onClick={addOwedRow}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                owedRows.length > 0
                  ? "border-amber-500/45 bg-amber-500/15 text-amber-100"
                  : "border-slate-700/80 bg-slate-950/50 text-slate-300 hover:bg-slate-900/70"
              }`}
            >
              {owedRows.length > 0 ? "Someone else owes too" : "Someone owes me"}
            </button>
              </>
            )}
          </div>

          {!receiptBreakdown ? (
            <>
              <LabeledField label="Amount" hint="Tip: use a negative amount for full refunds or chargebacks.">
                <CurrencyAmountInput
                  name="amount"
                  placeholder="0.00 (negative for credits)"
                  value={amountValue}
                  onChange={(e) => setAmountValue(e.target.value)}
                  required
                />
              </LabeledField>
              <input type="hidden" name="preCreditTotal" value="" />
              <input type="hidden" name="creditTotal" value="" />
            </>
          ) : (
            <div
              className={`${spanFullSm} space-y-4 rounded-xl border border-emerald-500/20 bg-gradient-to-br from-slate-950/80 to-slate-900/40 p-4 ring-1 ring-emerald-500/10`}
            >
              <div className="space-y-1">
                <p className="text-sm font-medium text-slate-100">Totals from your receipt</p>
                <p className="text-xs leading-relaxed text-slate-500">
                  Net amount saved is total minus credits (shown as Paid in your log).
                </p>
              </div>
              <div className={formGridResponsive}>
                <CurrencyAmountInput
                  name="preCreditTotal"
                  label="Total before credits"
                  placeholder="0.00"
                  value={preCreditValue}
                  onChange={(e) => setPreCreditValue(e.target.value)}
                  required
                />
                <div className="space-y-2">
                  <p className="text-sm font-medium text-slate-200">Credits & discounts</p>
                  <div className="space-y-2">
                    {creditRows.map((value, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <CurrencyAmountInput
                          name="creditTotal"
                          label={undefined}
                          placeholder={idx === 0 ? "0.00" : `Credit #${idx + 1}`}
                          value={value}
                          onChange={(e) =>
                            setCreditRows((rows) => rows.map((r, i) => (i === idx ? e.target.value : r)))
                          }
                        />
                        {creditRows.length > 1 ? (
                          <button
                            type="button"
                            onClick={() =>
                              setCreditRows((rows) => rows.filter((_, i) => i !== idx))
                            }
                            className="shrink-0 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
                            aria-label={`Remove credit ${idx + 1}`}
                          >
                            Remove
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setCreditRows((rows) => [...rows, ""])}
                    className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-800"
                  >
                    Add another credit
                  </button>
                  <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 px-3 py-2 text-xs text-slate-300">
                    <p className="tabular-nums">
                      Credit sum: <span className="font-medium text-emerald-300">{creditSum.toFixed(2)}</span>
                    </p>
                    <p className="mt-1 tabular-nums text-slate-400">
                      Net paid preview:{" "}
                      <span className="font-medium text-slate-200">
                        {netPaidPreview !== null ? netPaidPreview.toFixed(2) : "--"}
                      </span>
                    </p>
                  </div>
                </div>
              </div>
              <p className="border-t border-slate-800/90 pt-3 text-xs leading-relaxed text-slate-500">
                Enter the full receipt total first, then add each reward, coupon, or statement credit separately. We
                automatically sum all credits and save your paid amount as{" "}
                <span className="font-medium text-slate-300">total minus combined credits</span>.
              </p>
              <input type="hidden" name="amount" value="" />
            </div>
          )}

          <input type="hidden" name={OWED_SHARES_FIELD} value="1" />
          {owedRows.length > 0 ? (
            <div
              className={`${spanFullSm} space-y-3 rounded-xl border border-amber-500/20 bg-slate-950/60 p-4`}
              data-testid="owed-shares-editor"
            >
              <div className="space-y-1">
                <p className="text-sm font-medium text-slate-100">Owed to you</p>
                <p className="text-xs leading-relaxed text-slate-500">
                  Left out of your spending from now on. Track it under Owed to you until it is paid back.
                </p>
              </div>
              {owedRows.map((row, idx) => (
                <div key={row.key} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="owedShareId" value={row.id ?? ""} />
                  <label className="min-w-[8rem] flex-1 space-y-1">
                    <span className="text-xs font-medium text-slate-400">Who</span>
                    <input
                      name="owedName"
                      value={row.name}
                      maxLength={OWED_SHARE_NAME_MAX}
                      onChange={(e) => updateOwedRow(row.key, { name: e.target.value })}
                      placeholder="Name"
                      className={inputClass}
                      aria-label={`Who owes amount ${idx + 1}`}
                      required
                    />
                  </label>
                  <div className="w-36">
                    <CurrencyAmountInput
                      name="owedAmount"
                      label="Owes"
                      placeholder="0.00"
                      value={row.amount}
                      onChange={(e) => updateOwedRow(row.key, { amount: e.target.value })}
                      required
                    />
                  </div>
                  {row.paid ? <span className="pb-2 text-xs text-emerald-300">Paid back</span> : null}
                  <button
                    type="button"
                    onClick={() => setOwedRows((rows) => rows.filter((r) => r.key !== row.key))}
                    className="mb-0.5 shrink-0 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                    aria-label={`Remove what ${row.name || `person ${idx + 1}`} owes`}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <p className="text-xs tabular-nums text-slate-400">
                Your share:{" "}
                <span className="font-medium text-slate-200" data-testid="owed-own-part-preview">
                  {ownPartPreview !== null ? ownPartPreview.toFixed(2) : "--"}
                </span>
              </p>
            </div>
          ) : null}

          {isSplit ? (
            <div
              className={`${spanFullSm} space-y-3 rounded-xl border border-amber-500/20 bg-slate-950/60 p-4`}
              data-testid="split-lines-editor"
            >
              <input type="hidden" name={SPLIT_LINES_FIELD} value="1" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-slate-100">Split across categories</p>
                <p className="text-xs leading-relaxed text-slate-500">
                  The lines must add up to the amount. Leave one line and this becomes a regular expense in
                  that category.
                </p>
              </div>
              {splitRows.map((row, idx) => (
                <div key={row.key} className="flex flex-wrap items-end gap-2">
                  <label className="min-w-[8rem] flex-1 space-y-1">
                    <span className="text-xs font-medium text-slate-400">Category</span>
                    <select
                      name="splitCategoryId"
                      value={row.categoryId}
                      onChange={(e) => updateSplitRow(row.key, { categoryId: e.target.value })}
                      className={selectClass}
                      aria-label={`Split line ${idx + 1} category`}
                      required
                    >
                      {splitCategoryOptions.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="w-36">
                    <CurrencyAmountInput
                      name="splitAmount"
                      label="Amount"
                      placeholder="0.00"
                      value={row.amount}
                      onChange={(e) => updateSplitRow(row.key, { amount: e.target.value })}
                      required
                    />
                  </div>
                  {splitRows.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => setSplitRows((rows) => rows.filter((r) => r.key !== row.key))}
                      className="mb-0.5 shrink-0 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                      aria-label={`Remove split line ${idx + 1}`}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              ))}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={addSplitRow}
                  className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-800"
                >
                  Add line
                </button>
                <p
                  className={`text-xs tabular-nums ${splitLeftCents === 0 ? "text-emerald-300" : "text-amber-300"}`}
                  data-testid="split-left-to-assign"
                >
                  {splitLeftCents === null
                    ? "Enter the amount first"
                    : splitLeftCents === 0
                      ? "Lines match the amount"
                      : splitLeftCents > 0
                        ? `${formatCurrency(splitLeftCents)} left to assign`
                        : `${formatCurrency(-splitLeftCents)} over the amount`}
                </p>
              </div>
            </div>
          ) : null}

          <DateField
            name="date"
            label="Transaction date"
            hint="The date you assign to this purchase or charge."
            defaultValue={entry.dateYmd}
            required
          />
          {showPostedDate ? (
            <DateField
              name="postedDate"
              label="Posted date"
              hint="Optional. When the transaction cleared on your statement, if different from the transaction date."
              defaultValue={entry.postedDateYmd ?? undefined}
              className={spanFullSm}
            />
          ) : (
            <input type="hidden" name="postedDate" value="" />
          )}
          {showNote ? (
            <LabeledField label="Note" hint="Optional details (max 250 characters)." className={spanFullSm}>
              <textarea
                name="note"
                rows={4}
                maxLength={250}
                className={textAreaClass}
                placeholder="Extra context, memo, or split notes"
                defaultValue={entry.note ?? ""}
              />
            </LabeledField>
          ) : (
            <input type="hidden" name="note" value="" />
          )}
          {/* Closing the field removes the tags, the same way closing Note clears the note. */}
          {showTags ? (
            <div className={spanFullSm}>
              <TagInput defaultTags={entry.tags} suggestions={tagOptions.names} />
            </div>
          ) : (
            <input type="hidden" name="tags" value="" />
          )}
        </form>
        </FieldHintModeProvider>

        <MarkAsTransferSection transactionId={entry.id} kind="expense" onDone={onClose} />
      {confirm.dialog}
    </EditSheet>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-200 ${
        expanded ? "rotate-90" : ""
      }`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.25}
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
    </svg>
  );
}

function ExpenseLogRow({
  txn,
  density,
  onEdit,
}: {
  txn: ExpenseLogEntry;
  density: ExpenseLogDensity;
  onEdit: (id: string) => void;
}) {
  return (
    <button type="button" onClick={() => onEdit(txn.id)} className={transactionRowClass(density, "blue")}>
      <CategoryDot categoryIds={expenseDotCategories(txn)} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium leading-snug text-slate-100">{expenseLogHeading(txn)}</span>
        <ExpenseRowMeta txn={txn} density={density} />
      </span>
      <ExpenseAmountBlock txn={txn} />
    </button>
  );
}

function showGroupReceiptBreakdown(summary: ExpenseGroupSummary) {
  if (summary.preCreditCents == null || summary.preCreditCents <= 0) return false;
  if (summary.creditCents > 0) return true;
  return summary.preCreditCents !== summary.amountCents;
}

function groupCategorySummary(labels: string[]) {
  if (labels.length <= 2) return labels.join(", ");
  return `${labels.slice(0, 2).join(", ")} +${labels.length - 2}`;
}

function ExpenseLogGroupHeader({
  entries,
  summary,
  density,
  expanded,
  listId,
  onToggle,
}: {
  entries: ExpenseLogEntry[];
  summary: ExpenseGroupSummary;
  density: ExpenseLogDensity;
  expanded: boolean;
  listId: string;
  onToggle: () => void;
}) {
  const first = entries[0];
  const heading = first.title?.trim() || first.categoryLabel;
  const categories = groupCategorySummary(summary.categoryLabels);
  // A group is one account's, so one currency.
  const currency = first.currency ?? undefined;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-controls={listId}
      className={transactionRowClass(density, "blue")}
    >
      <CategoryDot categoryIds={entries.flatMap(expenseDotCategories)} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 font-medium leading-snug text-slate-100">
          <span className="min-w-0 truncate">{heading}</span>
          <ChevronIcon expanded={expanded} />
        </span>
        <TransactionMetaLine
          density={density}
          title={`${summary.count} transactions · ${categories} · ${first.accountLabel}`}
        >
          <MetaParts
            parts={[
              <span key="count" className="font-medium text-blue-300/90">
                {summary.count} transactions
              </span>,
              categories,
              first.accountLabel,
            ]}
          />
        </TransactionMetaLine>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5 text-right">
        <ExpenseAmount cents={summary.amountCents} currency={currency} />
        {showGroupReceiptBreakdown(summary) ? (
          <ReceiptBreakdown
            preCreditCents={summary.preCreditCents!}
            creditCents={summary.creditCents}
            currency={currency}
          />
        ) : null}
      </span>
    </button>
  );
}

function ExpenseLogGroupRows({
  entries,
  density,
  onEdit,
}: {
  entries: ExpenseLogEntry[];
  density: ExpenseLogDensity;
  onEdit: (id: string) => void;
}) {
  const listId = useId();
  const [expanded, setExpanded] = useState(false);
  const summary = useMemo(() => summarizeExpenseGroup(entries), [entries]);

  return (
    <div>
      <ExpenseLogGroupHeader
        entries={entries}
        summary={summary}
        density={density}
        expanded={expanded}
        listId={listId}
        onToggle={() => setExpanded((v) => !v)}
      />
      <div id={listId} hidden={!expanded} className="mb-1 ml-3 border-l border-slate-800/80 pl-2">
        {entries.map((txn) => (
          <ExpenseLogRow key={txn.id} txn={txn} density={density} onEdit={onEdit} />
        ))}
      </div>
    </div>
  );
}

export function ExpenseLogPanel({
  entries,
  accounts,
  categories,
  titleSuggestions,
  tagFilter,
  density = "expanded",
  maxHeight = "default",
}: {
  entries: ExpenseLogEntry[];
  accounts: Option[];
  categories: Option[];
  titleSuggestions: ExpenseTitleSuggestion[];
  /** The user's tags and the dashboard's `?tag=` filter; `entries` already honour it. */
  tagFilter?: { tags: TagOption[]; selectedId: string | null };
  /**
   * Density and list height are card settings on the dashboard layout, not per-device
   * localStorage as they once were: every other card setting lives with the account, and
   * splitting one of them across two stores is how the two copies drifted before.
   */
  density?: ExpenseLogDensity;
  maxHeight?: ListHeight;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  // A transaction picked in the master search opens here when it is one of this log's.
  useOpenRequest((id) => {
    if (entries.some((e) => e.id === id)) setEditingId(id);
  });
  const [searchQuery, setSearchQuery] = useState("");
  const filteredEntries = useMemo(
    () => entries.filter((e) => expenseLogMatchesQuery(e, searchQuery, formatCurrency)),
    [entries, searchQuery],
  );
  // Consolidate same-day repeats of the same titled purchase on the same account, then
  // put each day's rows under its date. A group's members share a date by construction.
  const days = useMemo(
    () => groupTransactionsByDay(groupExpenseLogEntries(filteredEntries), (group) => group.entries[0]),
    [filteredEntries],
  );
  const editing = editingId ? entries.find((e) => e.id === editingId) : null;
  const trimmedSearch = searchQuery.trim();

  return (
    <>
      <div className={`${LIST_MAX_HEIGHT_CLASS[maxHeight]} overflow-y-auto overflow-x-hidden pr-1 [-webkit-overflow-scrolling:touch]`}>
        {entries.length > 0 || tagFilter?.selectedId ? (
          <div className="sticky top-0 z-[3] mb-2 space-y-2 border-b border-slate-800/70 bg-slate-900/95 py-2 backdrop-blur-md sm:static sm:z-auto sm:mb-3 sm:border-0 sm:bg-transparent sm:py-0 sm:backdrop-blur-none">
            <div className="flex gap-2">
              <label className="block min-w-0 flex-1">
                <span className="sr-only">Search expense log</span>
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search title, category, account, note, amount…"
                  className={inputClass}
                  autoComplete="off"
                />
              </label>
              {tagFilter && (tagFilter.tags.length > 0 || tagFilter.selectedId) ? (
                <TagFilterSelect tags={tagFilter.tags} selectedId={tagFilter.selectedId} />
              ) : null}
            </div>
            <p className="text-xs text-slate-500">
              {trimmedSearch
                ? `${filteredEntries.length} of ${entries.length} shown`
                : `${entries.length} transaction${entries.length === 1 ? "" : "s"}`}
            </p>
          </div>
        ) : null}
        {entries.length === 0 ? (
          <p className="text-sm text-slate-400">
            {tagFilter?.selectedId ? "No expenses with this tag in this period." : "No expenses in this period."}
          </p>
        ) : filteredEntries.length === 0 ? (
          <p className="text-sm text-slate-400">No expenses match your search.</p>
        ) : (
          days.map((day) => {
            const total = homeCurrencyDayTotal(day.items.flatMap((group) => group.entries));
            return (
              <section key={day.dateYmd} aria-label={day.dateDisplay}>
                <TransactionDayHeader
                  dateDisplay={day.dateDisplay}
                  total={total === null ? null : formatCurrency(total)}
                />
                <TransactionDay>
                  {day.items.map((group) =>
                    group.entries.length === 1 ? (
                      <ExpenseLogRow key={group.key} txn={group.entries[0]} density={density} onEdit={setEditingId} />
                    ) : (
                      <ExpenseLogGroupRows
                        key={group.key}
                        entries={group.entries}
                        density={density}
                        onEdit={setEditingId}
                      />
                    ),
                  )}
                </TransactionDay>
              </section>
            );
          })
        )}
      </div>
      {editing ? (
        <EditExpenseModal
          key={editing.id}
          entry={editing}
          accounts={accounts}
          categories={categories}
          titleSuggestions={titleSuggestions}
          onClose={() => setEditingId(null)}
        />
      ) : null}
    </>
  );
}

/**
 * Narrows the dashboard to one tag through `?tag=`, so the income and transfer lists and
 * Spending by category follow along with this log, and the choice survives a reload. The
 * Reports page reuses it for the same parameter.
 */
export function TagFilterSelect({
  tags,
  selectedId,
  className = "block w-[38%] max-w-[12rem] shrink-0",
}: {
  tags: TagOption[];
  selectedId: string | null;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return (
    <label className={className}>
      <span className="sr-only">Filter by tag</span>
      <select
        className={`${inputClass} truncate`}
        value={selectedId ?? ""}
        data-testid="tag-filter"
        onChange={(e) => {
          const next = new URLSearchParams(searchParams.toString());
          if (e.target.value) next.set("tag", e.target.value);
          else next.delete("tag");
          const q = next.toString();
          router.push(q ? `${pathname}?${q}` : pathname, { scroll: false });
        }}
      >
        <option value="">All tags</option>
        {tags.map((tag) => (
          <option key={tag.id} value={tag.id}>
            #{tag.name}
          </option>
        ))}
      </select>
    </label>
  );
}
