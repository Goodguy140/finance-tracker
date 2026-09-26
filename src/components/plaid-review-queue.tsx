"use client";

import { useMemo, useState } from "react";
import { ServerActionForm } from "@/components/server-action-form";
import { MetaChip } from "@/components/meta-chip";
import { inputClass, primaryBtnClass, secondaryBtnClass } from "@/components/forms/shared";
import {
  applyBankRevisionAction,
  bulkAddStagedTransactionsAction,
  dismissBankRevisionAction,
  resolveStagedTransactionAction,
} from "@/app/actions/plaid";
import { formatCurrency } from "@/lib/money";

export type ReviewCandidate = {
  id: string;
  title: string;
  amountCents: number;
  dateDisplay: string;
};

export type ReviewRow = {
  id: string;
  institutionName: string;
  heading: string;
  amountCents: number;
  typeLabel: string;
  dateDisplay: string;
  accountLabel: string;
  categoryOptions: { id: string; name: string }[];
  suggestedCategoryId: string;
  /** Why the title/category differ from the bank's own: one of the user's rules, or a
   * category learned from a past entry with the same title. */
  proposalReason: "rule" | "learned" | null;
  isPending: boolean;
  /** Proposed link, when the matcher found a plausible one. */
  match: { candidate: ReviewCandidate; tier: "high" | "low"; reasons: string[] } | null;
};

export type RevisionRow = {
  id: string;
  heading: string;
  institutionName: string;
  approvedAmountCents: number;
  bankAmountCents: number;
  bankDateDisplay: string;
};

export type PlaidReviewQueueProps = {
  rows: ReviewRow[];
  revisions: RevisionRow[];
};

function AmountText({ cents }: { cents: number }) {
  // A negative expense is a refund; the log already renders those as credits, so the
  // queue uses the same language rather than showing a bare minus sign.
  const credit = cents < 0;
  return (
    <span className={credit ? "text-emerald-300" : "text-slate-100"}>
      {credit ? `+${formatCurrency(Math.abs(cents))}` : formatCurrency(cents)}
    </span>
  );
}

function ReviewRowCard({ row }: { row: ReviewRow }) {
  // Pre-selection follows the matcher's confidence: a strong match proposes Link, anything
  // weaker proposes Add and shows the candidate so the user can override.
  const [decision, setDecision] = useState<"link" | "add" | "ignore">(
    row.match?.tier === "high" ? "link" : "add",
  );

  return (
    <li className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-100">{row.heading}</p>
          <p className="text-xs text-slate-500">
            {row.dateDisplay} · {row.accountLabel}
            {row.isPending ? " · pending" : ""}
            {row.proposalReason === "rule"
              ? " · filled in by your rules"
              : row.proposalReason === "learned"
                ? " · category from a past entry"
                : ""}
          </p>
        </div>
        <p className="text-sm font-semibold">
          <AmountText cents={row.amountCents} />
        </p>
      </div>

      {row.match ? (
        <div className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-xs text-slate-300">
          <p>
            Looks like{" "}
            <span className="font-medium text-slate-100">{row.match.candidate.title}</span>{" "}
            ({formatCurrency(Math.abs(row.match.candidate.amountCents))} ·{" "}
            {row.match.candidate.dateDisplay})
          </p>
          <p className="mt-0.5 text-slate-500">{row.match.reasons.join(" · ")}</p>
        </div>
      ) : null}

      <ServerActionForm action={resolveStagedTransactionAction} className="space-y-2">
        <input type="hidden" name="stagedId" value={row.id} />
        <input type="hidden" name="decision" value={decision} />
        {row.match ? (
          <input type="hidden" name="linkTransactionId" value={row.match.candidate.id} />
        ) : null}

        <div className="flex flex-wrap gap-1.5" role="group" aria-label={`What to do with ${row.heading}`}>
          {(
            [
              ["link", "Link"],
              ["add", "Add as new"],
              ["ignore", "Ignore"],
            ] as const
          ).map(([value, label]) => {
            const disabled = value === "link" && !row.match;
            const active = decision === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                disabled={disabled}
                onClick={() => setDecision(value)}
                className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  active
                    ? "border-blue-400/60 bg-blue-500/15 text-blue-100"
                    : "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {decision === "add" ? (
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-400">Category</span>
            <select
              name="categoryId"
              defaultValue={row.suggestedCategoryId}
              className={inputClass}
              aria-label={`Category for ${row.heading}`}
            >
              {row.categoryOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <button type="submit" className={secondaryBtnClass}>
          {decision === "link" ? "Link it" : decision === "add" ? "Add it" : "Ignore it"}
        </button>
      </ServerActionForm>
    </li>
  );
}

export function PlaidReviewQueue({ rows, revisions }: PlaidReviewQueueProps) {
  const [open, setOpen] = useState(true);
  const unmatchedIds = useMemo(
    () => rows.filter((row) => !row.match).map((row) => row.id),
    [rows],
  );

  if (rows.length === 0 && revisions.length === 0) return null;

  return (
    <section className="space-y-3 rounded-2xl border border-blue-500/30 bg-blue-950/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold text-slate-100">From your bank</h2>
          <MetaChip label="To review">{String(rows.length)}</MetaChip>
          {revisions.length > 0 ? <MetaChip label="Revised">{String(revisions.length)}</MetaChip> : null}
        </div>
        <button
          type="button"
          className={secondaryBtnClass}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? "Hide" : "Show"}
        </button>
      </div>

      <p className="text-xs text-slate-400">
        Nothing here is in your log yet. Link each one to something you already entered, add
        it as new, or ignore it.
      </p>

      {open ? (
        <>
          {revisions.length > 0 ? (
            <div className="space-y-2 rounded-xl border border-amber-500/35 bg-amber-950/25 p-3">
              <h3 className="text-sm font-semibold text-amber-100">
                Your bank revised {revisions.length} transaction{revisions.length === 1 ? "" : "s"}
              </h3>
              <p className="text-xs text-amber-100/80">
                These are already in your log. The bank now reports a different amount —
                nothing was changed without asking.
              </p>
              <ul className="space-y-2">
                {revisions.map((revision) => (
                  <li
                    key={revision.id}
                    className="flex flex-col gap-2 rounded-lg border border-amber-500/25 bg-slate-950/40 p-2.5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 text-xs">
                      <p className="truncate font-medium text-slate-100">{revision.heading}</p>
                      <p className="text-slate-400">
                        You approved {formatCurrency(Math.abs(revision.approvedAmountCents))};{" "}
                        {revision.institutionName} now reports{" "}
                        {formatCurrency(Math.abs(revision.bankAmountCents))} on{" "}
                        {revision.bankDateDisplay}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <ServerActionForm action={applyBankRevisionAction}>
                        <input type="hidden" name="stagedId" value={revision.id} />
                        <button className={secondaryBtnClass} type="submit">
                          Use the bank’s values
                        </button>
                      </ServerActionForm>
                      <ServerActionForm action={dismissBankRevisionAction}>
                        <input type="hidden" name="stagedId" value={revision.id} />
                        <button className={secondaryBtnClass} type="submit">
                          Keep mine
                        </button>
                      </ServerActionForm>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {unmatchedIds.length > 1 ? (
            <ServerActionForm action={bulkAddStagedTransactionsAction}>
              <input type="hidden" name="stagedIdsJson" value={JSON.stringify(unmatchedIds)} />
              <button className={primaryBtnClass} type="submit">
                Add all {unmatchedIds.length} unmatched
              </button>
            </ServerActionForm>
          ) : null}

          <ul className="space-y-2">
            {rows.map((row) => (
              <ReviewRowCard key={row.id} row={row} />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
