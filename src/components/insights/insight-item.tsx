"use client";

import Link from "next/link";
import { useId, useState } from "react";
import {
  createRecurringTransactionAction,
  dismissInsightAction,
  restoreInsightAction,
  trackHabitSeparatelyAction,
} from "@/app/actions";
import { ServerActionForm } from "@/components/server-action-form";
import {
  CurrencyAmountInput,
  DateField,
  formGridResponsive,
  LabeledField,
  primaryBtnClass,
  secondaryBtnClass,
  selectClass,
  inputClass,
  spanFullSm,
  type Option,
} from "@/components/forms/shared";
import { HABIT_CATEGORY_NAMES } from "@/lib/insights/habit-patterns";
import type { Insight, InsightSeverity, RecurringPrefill } from "@/lib/insights/types";
import { formatCurrency } from "@/lib/money";

/** An evidence row, flattened for the client: no Dates cross the boundary. */
export type InsightEvidenceRow = { id: string; date: string; title: string; amountCents: number; type: "EXPENSE" | "INCOME" | "TRANSFER" };

export type InsightItemView = Insight & {
  evidence: InsightEvidenceRow[];
  /** Set on a dismissed or snoozed insight. ISO date, or null for "for good". */
  dismissedUntil?: string | null;
};

export type InsightFormOptions = {
  accounts: Option[];
  expenseCategories: Option[];
  incomeCategories: Option[];
  /** Expense category names the user already has, to tell a tracked habit from an untracked one. */
  expenseCategoryNames: string[];
  currency: string;
};

const SEVERITY_DOT: Record<InsightSeverity, string> = {
  high: "bg-amber-400",
  medium: "bg-blue-400",
  low: "bg-slate-500",
};

const SEVERITY_LABEL: Record<InsightSeverity, string> = {
  high: "Worth a look soon",
  medium: "Worth a look",
  low: "For your information",
};

const smallBtn =
  "touch-manipulation inline-flex min-h-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800";
const smallPrimaryBtn =
  "touch-manipulation inline-flex min-h-9 items-center justify-center rounded-lg bg-blue-500 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-blue-400";

function DismissButton({ insightKey, mode, label }: { insightKey: string; mode: "snooze" | "forever"; label: string }) {
  return (
    <ServerActionForm action={dismissInsightAction}>
      <input type="hidden" name="insightKey" value={insightKey} />
      <input type="hidden" name="mode" value={mode} />
      <button type="submit" className={smallBtn}>
        {label}
      </button>
    </ServerActionForm>
  );
}

function TrackRecurringForm({
  prefill,
  options,
  onDone,
}: {
  prefill: RecurringPrefill;
  options: InsightFormOptions;
  onDone: () => void;
}) {
  const ids = useId();
  const categories = prefill.type === "INCOME" ? options.incomeCategories : options.expenseCategories;
  const accountDefault =
    prefill.accountId && options.accounts.some((a) => a.id === prefill.accountId)
      ? prefill.accountId
      : (options.accounts[0]?.id ?? "");
  const categoryDefault = categories.some((c) => c.id === prefill.categoryId) ? prefill.categoryId : categories[0]?.id;

  return (
    <ServerActionForm
      action={createRecurringTransactionAction}
      onSuccess={onDone}
      className={`${formGridResponsive} mt-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3`}
    >
      <input type="hidden" name="type" value={prefill.type} />
      <LabeledField label="Name" className={spanFullSm}>
        <input id={`${ids}-name`} name="name" defaultValue={prefill.name} maxLength={80} className={inputClass} required />
      </LabeledField>
      <LabeledField label="Account">
        <select name="accountId" defaultValue={accountDefault} className={selectClass}>
          {options.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </LabeledField>
      <LabeledField label="Category">
        <select name="categoryId" defaultValue={categoryDefault} className={selectClass}>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </LabeledField>
      <CurrencyAmountInput
        name="amount"
        label="Amount each time"
        placeholder="0.00"
        defaultValue={(prefill.amountCents / 100).toFixed(2)}
        required
      />
      <LabeledField label="Cadence">
        <select name="cadence" defaultValue={prefill.cadence} className={selectClass}>
          <option value="WEEKLY">Weekly</option>
          <option value="BIWEEKLY">Biweekly</option>
          <option value="MONTHLY">Monthly</option>
          <option value="QUARTERLY">Quarterly</option>
          <option value="YEARLY">Yearly</option>
          <option value="BIENNIAL">Every 2 years</option>
        </select>
      </LabeledField>
      <DateField name="nextExpectedDate" label="Next expected date" defaultValue={prefill.nextExpectedDate} required />
      <LabeledField label="Posting">
        <select name="postMode" defaultValue="REVIEW" className={selectClass}>
          <option value="REVIEW">Post by hand when due</option>
          <option value="AUTO">Post automatically when due</option>
        </select>
      </LabeledField>
      <div className={`${spanFullSm} flex flex-wrap gap-2`}>
        <button type="submit" className={primaryBtnClass}>
          Add recurring transaction
        </button>
        <button type="button" className={secondaryBtnClass} onClick={onDone}>
          Cancel
        </button>
      </div>
    </ServerActionForm>
  );
}

function HabitActions({ insight, options }: { insight: InsightItemView; options: InsightFormOptions }) {
  if (insight.action?.kind !== "track-habit") return null;
  const categoryName = HABIT_CATEGORY_NAMES[insight.action.habit];
  const tracked = options.expenseCategoryNames.some((n) => n.toLowerCase() === categoryName.toLowerCase());
  if (tracked) {
    return (
      <p className="text-xs text-slate-400">
        Tracked in <span className="font-medium text-slate-200">{categoryName}</span>.{" "}
        <Link href="/settings#budgets" className="text-blue-300 underline underline-offset-4">
          Set a budget
        </Link>{" "}
        ·{" "}
        <Link href="/settings#rules" className="text-blue-300 underline underline-offset-4">
          Apply rules to past purchases
        </Link>
      </p>
    );
  }
  return (
    <ServerActionForm action={trackHabitSeparatelyAction}>
      <input type="hidden" name="habit" value={insight.action.habit} />
      <button
        type="submit"
        className={smallPrimaryBtn}
        title={`Creates a “${categoryName}” category and a rule for each merchant, so you can budget it.`}
      >
        Track separately
      </button>
    </ServerActionForm>
  );
}

export function InsightItem({ insight, options }: { insight: InsightItemView; options: InsightFormOptions }) {
  const [tracking, setTracking] = useState(false);
  const fmt = (cents: number) => formatCurrency(cents, options.currency);
  const dismissed = insight.dismissedUntil !== undefined;

  return (
    <li
      className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"
      data-testid="insight"
      data-insight-key={insight.key}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[insight.severity]}`}
          role="img"
          aria-label={SEVERITY_LABEL[insight.severity]}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-100">{insight.title}</p>
          <p className="mt-1 text-sm leading-relaxed text-slate-300">{insight.body}</p>

          {insight.evidence.length > 0 ? (
            <details className="mt-2 text-xs text-slate-400">
              <summary className="cursor-pointer select-none text-slate-400 hover:text-slate-200">
                {insight.evidence.length === 1 ? "1 transaction" : `${insight.evidence.length} transactions`}
              </summary>
              <ul className="mt-1.5 space-y-1">
                {insight.evidence.map((row) => (
                  <li key={row.id} className="flex justify-between gap-3 tabular-nums">
                    <span className="min-w-0 truncate">
                      <span className="text-slate-500">{row.date}</span> {row.title || "Untitled"}
                    </span>
                    <span className={row.type === "INCOME" ? "text-emerald-300" : "text-slate-300"}>{fmt(row.amountCents)}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {dismissed ? (
              <>
                <span className="text-xs text-slate-500">
                  {insight.dismissedUntil ? `Snoozed until ${insight.dismissedUntil}` : "Dismissed"}
                </span>
                <ServerActionForm action={restoreInsightAction}>
                  <input type="hidden" name="insightKey" value={insight.key} />
                  <button type="submit" className={smallBtn}>
                    Restore
                  </button>
                </ServerActionForm>
              </>
            ) : (
              <>
                {insight.action?.kind === "track-recurring" && !tracking ? (
                  <button type="button" className={smallPrimaryBtn} onClick={() => setTracking(true)}>
                    Track it
                  </button>
                ) : null}
                {insight.section === "habit" ? <HabitActions insight={insight} options={options} /> : null}
                {insight.action?.kind === "link" ? (
                  <Link href={insight.action.href} className={smallPrimaryBtn}>
                    {insight.action.label}
                  </Link>
                ) : null}
                {insight.section === "recurring" ? (
                  <DismissButton insightKey={insight.key} mode="forever" label="Not recurring" />
                ) : insight.section === "habit" ? (
                  <>
                    <DismissButton insightKey={insight.key} mode="snooze" label="Snooze 30 days" />
                    <DismissButton insightKey={insight.key} mode="forever" label="Don't flag this" />
                  </>
                ) : (
                  <>
                    <DismissButton insightKey={insight.key} mode="snooze" label="Snooze 30 days" />
                    <DismissButton insightKey={insight.key} mode="forever" label="Dismiss" />
                  </>
                )}
              </>
            )}
          </div>

          {tracking && insight.action?.kind === "track-recurring" ? (
            <TrackRecurringForm prefill={insight.action.prefill} options={options} onDone={() => setTracking(false)} />
          ) : null}
        </div>
      </div>
    </li>
  );
}
