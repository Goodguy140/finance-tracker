"use client";

import { isActionFailure } from "@/lib/action-result";
import { useActionState, useEffect, useId, useMemo, useState } from "react";
import { LIST_MAX_HEIGHT_CLASS } from "@/lib/dashboard-layout/display";
import type { ListHeight } from "@/lib/dashboard-layout/schema";
import { useRouter } from "next/navigation";
import { deleteExpenseTransactionAction, updateExpenseAction } from "@/app/actions";
import { MetaChip } from "@/components/meta-chip";
import { VerifiedBadge, verificationTooltip, type VerificationInfo } from "@/components/verified-badge";
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
  LabeledField,
  formGridResponsive,
  inputClass,
  primaryBtnClass,
  secondaryBtnClass,
  spanFullSm,
  textAreaClass,
} from "@/components/forms";
import { expenseLogMatchesQuery } from "@/lib/expense-title-suggestions";
import { MOBILE_OVERLAY_ROOT_Z_CLASS } from "@/lib/mobile-z-index";
import { formatCurrency } from "@/lib/money";

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
  /** Set once the transaction has been confirmed against a bank record. */
  verification: VerificationInfo | null;
};

type UpdateState = { ok: true } | { ok: false; error: string | null };

type DeleteState = { ok: true } | { ok: false; error: string | null };

type ExpenseLogDensity = "expanded" | "compact";


function showReceiptBreakdown(txn: ExpenseLogEntry) {
  if (txn.preCreditCents == null || txn.preCreditCents <= 0) return false;
  if ((txn.creditCents ?? 0) > 0) return true;
  return txn.preCreditCents !== txn.amountCents;
}

function ExpenseAmountBlock({ txn, size }: { txn: ExpenseLogEntry; size: "default" | "compact" }) {
  const meta = showReceiptBreakdown(txn);
  const textClass =
    size === "compact" ? "text-[10px] leading-tight" : "text-xs leading-snug";
  return (
    <div className="flex shrink-0 flex-col items-end gap-1 text-right">
      <AmountPill cents={txn.amountCents} size={size} />
      {meta ? (
        <div className={`max-w-[16rem] space-y-0.5 ${textClass}`}>
          <p className="tabular-nums text-slate-400">
            Total <span className="font-medium text-slate-300">{formatCurrency(txn.preCreditCents!)}</span>
          </p>
          {(txn.creditCents ?? 0) > 0 ? (
            <p className="tabular-nums text-emerald-400/95">
              Credits <span className="font-medium">{formatCurrency(-(txn.creditCents ?? 0))}</span>
            </p>
          ) : null}
        </div>
      ) : null}
      {/* The verification mark sits under the amount rather than in the chip row: it is a
          statement about this figure, and the chip row is already the longest line here. */}
      {txn.verification ? (
        <VerifiedBadge info={txn.verification} variant={size === "compact" ? "text" : "chip"} />
      ) : null}
    </div>
  );
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
          : `shrink-0 rounded-full border border-violet-500/35 bg-violet-500/15 text-violet-100 ${sizeClass}`
      }
    >
      {credit ? formatCurrency(cents) : <>Paid {formatCurrency(cents)}</>}
    </span>
  );
}

function expenseLogHeading(txn: ExpenseLogEntry) {
  return txn.title?.trim() || txn.categoryLabel;
}

function ExpenseChipRow({ txn }: { txn: ExpenseLogEntry }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      <MetaChip label="Category">{txn.categoryLabel}</MetaChip>
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
    const parts: string[] = [txn.categoryLabel, txn.accountLabel, txn.dateDisplay];
    if (txn.postedDateDisplay) parts.push(`posted ${txn.postedDateDisplay}`);
    if (txn.note) parts.push(txn.note);
    const line = parts.join(" · ");
    // `title` never fires on touch, so the verification detail is spelled out here
    // rather than living only in the badge tooltip.
    const fullTitle = [
      isSplit ? "Split (view only)" : null,
      line,
      txn.verification ? verificationTooltip(txn.verification) : null,
    ].filter(Boolean).join(" · ");
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
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center rounded-full border border-amber-500/35 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-100 sm:text-xs">
            Split — view only
          </span>
        </div>
      ) : null}
      <ExpenseChipRow txn={txn} />
    </>
  );
}

function ExpenseLogMobileCard({
  txn,
  pillSize,
  isSplit,
}: {
  txn: ExpenseLogEntry;
  pillSize: "default" | "compact";
  isSplit: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 sm:hidden">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-300/90">Expense</p>
          <p className="mt-0.5 text-base font-semibold leading-snug text-slate-50">{expenseLogHeading(txn)}</p>
        </div>
        <ExpenseAmountBlock txn={txn} size={pillSize} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <MetaChip label="Category">{txn.categoryLabel}</MetaChip>
        {isSplit ? (
          <span className="inline-flex items-center rounded-full border border-amber-500/35 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-100">
            Split — view only
          </span>
        ) : null}
      </div>
      <p className="text-xs leading-snug text-slate-500">
        <span className="font-medium text-slate-400">{txn.accountLabel}</span>
        <span className="text-slate-600"> · </span>
        <span>{txn.dateDisplay}</span>
        {txn.postedDateDisplay ? (
          <>
            <span className="text-slate-600"> · </span>
            <span>posted {txn.postedDateDisplay}</span>
          </>
        ) : null}
        {/* The badge carries its detail in `title`, which never fires on touch — so on a
            phone the same sentence is spelled out here instead. */}
        {txn.verification ? (
          <>
            <span className="text-slate-600"> · </span>
            <span>{verificationTooltip(txn.verification)}</span>
          </>
        ) : null}
      </p>
      {txn.note ? <p className="text-xs leading-snug text-slate-400">{txn.note}</p> : null}
    </div>
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
  const [receiptBreakdown, setReceiptBreakdown] = useState(
    entry.preCreditCents != null && entry.preCreditCents > 0,
  );
  const [showPostedDate, setShowPostedDate] = useState(entry.postedDateYmd != null);
  const [showNote, setShowNote] = useState(Boolean(entry.note));

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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const amountDollars = (entry.amountCents / 100).toFixed(2);
  const preDollarsDefault =
    entry.preCreditCents != null ? (entry.preCreditCents / 100).toFixed(2) : amountDollars;
  const creditDollarsDefault =
    entry.creditCents != null ? (entry.creditCents / 100).toFixed(2) : "";
  const [amountValue, setAmountValue] = useState(amountDollars);
  const [preCreditValue, setPreCreditValue] = useState(preDollarsDefault);
  const [creditRows, setCreditRows] = useState<string[]>(
    parseCreditRowsFromJson(entry.creditBreakdownJson, creditDollarsDefault),
  );
  const creditSum = sumCredits(creditRows);
  const preCreditNumber = Number(preCreditValue);
  const hasValidPreCredit = Number.isFinite(preCreditNumber);
  const netPaidPreview = hasValidPreCredit ? preCreditNumber - creditSum : null;

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
        aria-labelledby="edit-expense-title"
        className="max-h-[min(90dvh,40rem)] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-slate-700 border-b-0 bg-slate-900 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 shadow-2xl sm:rounded-2xl sm:border-b sm:px-5 sm:pb-5 sm:pt-5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 id="edit-expense-title" className="mb-4 text-lg font-semibold text-slate-100">
          Edit expense
        </h3>
        <form action={formAction} className={formGridResponsive}>
          <input type="hidden" name="transactionId" value={entry.id} />
          <ExpenseTitleAndCategoryFields
            fieldIds={fieldIds}
            expenseCategories={categories}
            titleSuggestions={titleSuggestions}
            defaultTitle={entry.title ?? ""}
            defaultCategoryId={entry.categoryId}
            accounts={accounts}
            accountSelectDefault={entry.accountId ?? ""}
            accountRemovedFallback={!entry.accountId}
          />

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
              onClick={toggleReceiptBreakdown}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                receiptBreakdown
                  ? "border-emerald-500/45 bg-emerald-500/15 text-emerald-100"
                  : "border-slate-700/80 bg-slate-950/50 text-slate-300 hover:bg-slate-900/70"
              }`}
            >
              Receipt breakdown
            </button>
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
            Remove this expense from your log and category totals. This cannot be undone.
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
                    "Delete this expense permanently? This cannot be undone.",
                  )
                ) {
                  e.preventDefault();
                }
              }}
            >
              {deletePending ? "Deleting…" : "Delete expense"}
            </button>
          </form>
        </div>
      </div>
    </div>
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
  pillSize,
  cardPad,
  onEdit,
}: {
  txn: ExpenseLogEntry;
  density: ExpenseLogDensity;
  pillSize: "default" | "compact";
  cardPad: string;
  onEdit: (id: string) => void;
}) {
  const body = (
    <>
      <ExpenseLogMobileCard txn={txn} pillSize={pillSize} isSplit={txn.isSplit} />
      <div className="hidden sm:block">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <span className="block font-semibold leading-snug text-slate-100">
              {expenseLogHeading(txn)}
            </span>
            <ExpenseLogMeta txn={txn} density={density} isSplit={txn.isSplit} />
          </div>
          <ExpenseAmountBlock txn={txn} size={pillSize} />
        </div>
      </div>
    </>
  );

  if (txn.isSplit) {
    return (
      <div className={`rounded-xl border border-slate-800 bg-slate-950/50 text-sm opacity-90 ${cardPad}`}>
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onEdit(txn.id)}
      className={`w-full rounded-xl border border-slate-800 bg-slate-950/50 text-left text-sm text-slate-100 transition hover:border-blue-500/40 hover:bg-slate-900/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 touch-manipulation ${cardPad}`}
    >
      {body}
    </button>
  );
}

function showGroupReceiptBreakdown(summary: ExpenseGroupSummary) {
  if (summary.preCreditCents == null || summary.preCreditCents <= 0) return false;
  if (summary.creditCents > 0) return true;
  return summary.preCreditCents !== summary.amountCents;
}

function ExpenseGroupAmountBlock({
  summary,
  size,
}: {
  summary: ExpenseGroupSummary;
  size: "default" | "compact";
}) {
  const meta = showGroupReceiptBreakdown(summary);
  const textClass = size === "compact" ? "text-[10px] leading-tight" : "text-xs leading-snug";
  return (
    <div className="flex shrink-0 flex-col items-end gap-1 text-right">
      <AmountPill cents={summary.amountCents} size={size} />
      {meta ? (
        <div className={`max-w-[16rem] space-y-0.5 ${textClass}`}>
          <p className="tabular-nums text-slate-400">
            Total <span className="font-medium text-slate-300">{formatCurrency(summary.preCreditCents!)}</span>
          </p>
          {summary.creditCents > 0 ? (
            <p className="tabular-nums text-emerald-400/95">
              Credits <span className="font-medium">{formatCurrency(-summary.creditCents)}</span>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function groupCategorySummary(labels: string[]) {
  if (labels.length <= 2) return labels.join(", ");
  return `${labels.slice(0, 2).join(", ")} +${labels.length - 2}`;
}

function CountChip({ count }: { count: number }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-blue-500/40 bg-blue-500/15 px-2.5 py-1 text-[11px] font-medium text-blue-100 sm:text-xs">
      {count} transactions
    </span>
  );
}

function ExpenseLogGroupHeader({
  entries,
  summary,
  density,
  pillSize,
  cardPad,
  expanded,
  listId,
  onToggle,
}: {
  entries: ExpenseLogEntry[];
  summary: ExpenseGroupSummary;
  density: ExpenseLogDensity;
  pillSize: "default" | "compact";
  cardPad: string;
  expanded: boolean;
  listId: string;
  onToggle: () => void;
}) {
  const first = entries[0];
  const heading = first.title?.trim() || first.categoryLabel;
  const categories = groupCategorySummary(summary.categoryLabels);
  const compactLine = [categories, first.accountLabel, first.dateDisplay].join(" · ");

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-controls={listId}
      className={`w-full rounded-xl border border-slate-800 bg-slate-950/50 text-left text-sm text-slate-100 transition hover:border-blue-500/40 hover:bg-slate-900/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 touch-manipulation ${cardPad}`}
    >
      <div className="flex flex-col gap-2 sm:hidden">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-300/90">Expense</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-base font-semibold leading-snug text-slate-50">
              <ChevronIcon expanded={expanded} />
              <span className="min-w-0 truncate">{heading}</span>
            </p>
          </div>
          <ExpenseGroupAmountBlock summary={summary} size={pillSize} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <CountChip count={summary.count} />
          <MetaChip label="Category">{categories}</MetaChip>
        </div>
        <p className="text-xs leading-snug text-slate-500">
          <span className="font-medium text-slate-400">{first.accountLabel}</span>
          <span className="text-slate-600"> · </span>
          <span>{first.dateDisplay}</span>
        </p>
      </div>

      <div className="hidden sm:block">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 font-semibold leading-snug text-slate-100">
              <ChevronIcon expanded={expanded} />
              <span className="min-w-0 truncate">{heading}</span>
            </span>
            {density === "compact" ? (
              <p
                className="mt-1 line-clamp-2 text-[11px] leading-snug text-slate-400 sm:text-xs"
                title={`${summary.count} transactions · ${compactLine}`}
              >
                <span className="font-medium text-blue-300/90">{summary.count} transactions</span>
                <span className="text-slate-600"> · </span>
                {compactLine}
              </p>
            ) : (
              <div className="mt-1 flex flex-wrap gap-1.5">
                <CountChip count={summary.count} />
                <MetaChip label="Category">{categories}</MetaChip>
                <MetaChip label="Account">{first.accountLabel}</MetaChip>
                <MetaChip label="Transaction">{first.dateDisplay}</MetaChip>
              </div>
            )}
          </div>
          <ExpenseGroupAmountBlock summary={summary} size={pillSize} />
        </div>
      </div>
    </button>
  );
}

function ExpenseLogGroupRows({
  entries,
  density,
  pillSize,
  cardPad,
  onEdit,
}: {
  entries: ExpenseLogEntry[];
  density: ExpenseLogDensity;
  pillSize: "default" | "compact";
  cardPad: string;
  onEdit: (id: string) => void;
}) {
  const listId = useId();
  const [expanded, setExpanded] = useState(false);
  const summary = useMemo(() => summarizeExpenseGroup(entries), [entries]);

  return (
    <div className="space-y-2">
      <ExpenseLogGroupHeader
        entries={entries}
        summary={summary}
        density={density}
        pillSize={pillSize}
        cardPad={cardPad}
        expanded={expanded}
        listId={listId}
        onToggle={() => setExpanded((v) => !v)}
      />
      <div id={listId} hidden={!expanded} className="ml-3 space-y-2 border-l border-slate-800/80 pl-3">
        {entries.map((txn) => (
          <ExpenseLogRow
            key={txn.id}
            txn={txn}
            density={density}
            pillSize={pillSize}
            cardPad={cardPad}
            onEdit={onEdit}
          />
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
  density = "expanded",
  maxHeight = "default",
}: {
  entries: ExpenseLogEntry[];
  accounts: Option[];
  categories: Option[];
  titleSuggestions: ExpenseTitleSuggestion[];
  /**
   * Density and list height are card settings on the dashboard layout, not per-device
   * localStorage as they once were: every other card setting lives with the account, and
   * splitting one of them across two stores is how the two copies drifted before.
   */
  density?: ExpenseLogDensity;
  maxHeight?: ListHeight;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const filteredEntries = useMemo(
    () => entries.filter((e) => expenseLogMatchesQuery(e, searchQuery, formatCurrency)),
    [entries, searchQuery],
  );
  // Consolidate same-day repeats of the same titled purchase on the same account.
  const groups = useMemo(() => groupExpenseLogEntries(filteredEntries), [filteredEntries]);
  const editing = editingId ? entries.find((e) => e.id === editingId) : null;
  const trimmedSearch = searchQuery.trim();

  const cardPad = density === "compact" ? "p-2" : "p-2.5";
  const pillSize = density === "compact" ? "compact" : "default";

  return (
    <>
      <div className={`${LIST_MAX_HEIGHT_CLASS[maxHeight]} overflow-y-auto overflow-x-hidden pr-1 [-webkit-overflow-scrolling:touch]`}>
        {entries.length > 0 ? (
          <div className="sticky top-0 z-[3] mb-2 space-y-2 border-b border-slate-800/70 bg-slate-900/95 py-2 backdrop-blur-md sm:static sm:z-auto sm:mb-3 sm:border-0 sm:bg-transparent sm:py-0 sm:backdrop-blur-none">
            <label className="block">
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
            <p className="text-xs text-slate-500">
              {trimmedSearch
                ? `${filteredEntries.length} of ${entries.length} shown`
                : `${entries.length} transaction${entries.length === 1 ? "" : "s"}`}
            </p>
          </div>
        ) : null}
        <div className="space-y-2">
          {entries.length === 0 ? (
            <p className="text-sm text-slate-400">No expenses in this period.</p>
          ) : filteredEntries.length === 0 ? (
            <p className="text-sm text-slate-400">No expenses match your search.</p>
          ) : (
            groups.map((group) =>
              group.entries.length === 1 ? (
                <ExpenseLogRow
                  key={group.key}
                  txn={group.entries[0]}
                  density={density}
                  pillSize={pillSize}
                  cardPad={cardPad}
                  onEdit={setEditingId}
                />
              ) : (
                <ExpenseLogGroupRows
                  key={group.key}
                  entries={group.entries}
                  density={density}
                  pillSize={pillSize}
                  cardPad={cardPad}
                  onEdit={setEditingId}
                />
              ),
            )
          )}
        </div>
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
