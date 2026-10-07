"use client";

import { useMemo, useState } from "react";
import { ServerActionForm } from "@/components/server-action-form";
import { MetaChip, TagChips } from "@/components/meta-chip";
import { inputClass, primaryBtnClass, secondaryBtnClass } from "@/components/forms/shared";
import {
  applyBankRevisionAction,
  bulkAddStagedTransactionsAction,
  dismissBankRevisionAction,
  pairStagedTransfersAction,
  resolveStagedTransactionAction,
} from "@/app/actions/plaid";
import { formatCurrency } from "@/lib/money";

export type ReviewCandidate = {
  id: string;
  title: string;
  amountCents: number;
  dateDisplay: string;
};

/** What adding a row would write, as the user's rules shape it. */
export type ReviewProposal = {
  title: string;
  note: string | null;
  tagNames: string[];
  /** Why the title/category differ from the bank's own: one of the user's rules, or a
   * category learned from a past entry with the same title. */
  reason: "rule" | "learned" | null;
};

export type ReviewRow = {
  id: string;
  institutionName: string;
  /** The title as the sync typed the row, for labelling it. */
  heading: string;
  /** The bank's own name for it, before any rule renamed it. */
  bankName: string;
  /** What adding it writes when booked as a transfer, and when not. */
  asTransfer: ReviewProposal;
  asNonTransfer: ReviewProposal;
  amountCents: number;
  /** The sync took it for money moving between the user's own accounts. */
  isTransfer: boolean;
  dateDisplay: string;
  accountLabel: string;
  /** What the row is booked as when it is not a transfer, and that type's categories. */
  nonTransferType: "EXPENSE" | "INCOME";
  categoryOptions: { id: string; name: string }[];
  suggestedCategoryId: string;
  isPending: boolean;
  /** Proposed link, when the matcher found a plausible one. */
  match: { candidate: ReviewCandidate; tier: "high" | "low"; reasons: string[] } | null;
  /** Another bank row that looks like the other side of the same transfer. */
  transferPair: {
    stagedId: string;
    heading: string;
    accountLabel: string;
    dateDisplay: string;
    /** The money left this row's account (and arrived in the other's). */
    outflow: boolean;
  } | null;
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
  // A pair beats a weak match: two bank rows agreeing to the cent on opposite sides is
  // stronger evidence than a hand-entered row that only roughly fits.
  const [decision, setDecision] = useState<"link" | "pair" | "add" | "ignore">(
    row.match?.tier === "high" ? "link" : row.transferPair ? "pair" : "add",
  );
  const [asTransfer, setAsTransfer] = useState(row.isTransfer);
  // What the chosen decision would write. Linking keeps the entry the user already made and
  // ignoring writes nothing, so rules only come into it when the row is added or paired.
  const committed =
    decision === "pair"
      ? row.asTransfer
      : decision === "add"
        ? asTransfer
          ? row.asTransfer
          : row.asNonTransfer
        : null;
  const shown = committed ?? (row.isTransfer ? row.asTransfer : row.asNonTransfer);
  const renamed = shown.title !== row.bankName;

  return (
    <li className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-100">{shown.title}</p>
          <p className="text-xs text-slate-500">
            {renamed ? `${row.bankName} · ` : ""}
            {row.dateDisplay} · {row.accountLabel}
            {row.isTransfer ? " · transfer" : ""}
            {row.isPending ? " · pending" : ""}
            {committed?.reason === "rule"
              ? " · filled in by your rules"
              : committed?.reason === "learned"
                ? " · category from a past entry"
                : ""}
          </p>
          {committed && (committed.note || committed.tagNames.length > 0) ? (
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-400" data-testid="review-rule-extras">
              {committed.note ? <span>Note: {committed.note}</span> : null}
              <TagChips tags={committed.tagNames} />
            </p>
          ) : null}
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

      {row.transferPair ? (
        <div className="rounded-lg border border-sky-500/30 bg-sky-950/30 px-3 py-2 text-xs text-slate-300">
          <p>
            Looks like the other side of a transfer:{" "}
            <span className="font-medium text-slate-100">{row.transferPair.heading}</span> (
            {row.transferPair.accountLabel} · {row.transferPair.dateDisplay})
          </p>
          <p className="mt-0.5 text-slate-500">
            {row.transferPair.outflow
              ? `${row.accountLabel} → ${row.transferPair.accountLabel}`
              : `${row.transferPair.accountLabel} → ${row.accountLabel}`}{" "}
            · same amount, opposite sides
          </p>
        </div>
      ) : null}

      <ServerActionForm
        action={decision === "pair" ? pairStagedTransfersAction : resolveStagedTransactionAction}
        className="space-y-2"
      >
        <input type="hidden" name="stagedId" value={row.id} />
        <input type="hidden" name="decision" value={decision} />
        {row.match ? (
          <input type="hidden" name="linkTransactionId" value={row.match.candidate.id} />
        ) : null}
        {decision === "pair" && row.transferPair ? (
          <input type="hidden" name="peerStagedId" value={row.transferPair.stagedId} />
        ) : null}

        <div className="flex flex-wrap gap-1.5" role="group" aria-label={`What to do with ${row.heading}`}>
          {(
            [
              ["link", "Link"],
              ...(row.transferPair ? ([["pair", "Pair as transfer"]] as const) : []),
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
          <>
            <input type="hidden" name="countAs" value={asTransfer ? "TRANSFER" : row.nonTransferType} />
            <label className="flex items-start gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={asTransfer}
                onChange={(e) => setAsTransfer(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Transfer between my accounts
                <span className="block text-slate-500">
                  Card payments and moves to savings. Not counted as spending or income.
                </span>
              </span>
            </label>
          </>
        ) : null}

        {decision === "add" && !asTransfer ? (
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
          {decision === "link"
            ? "Link it"
            : decision === "pair"
              ? "Add both as one transfer"
              : decision === "add"
                ? "Add it"
                : "Ignore it"}
        </button>
      </ServerActionForm>
    </li>
  );
}

export function PlaidReviewQueue({ rows, revisions }: PlaidReviewQueueProps) {
  const [open, setOpen] = useState(true);
  const unmatchedIds = useMemo(
    // A suggested transfer pair is left out: adding both sides on their own would lose the pair.
    () => rows.filter((row) => !row.match && !row.transferPair).map((row) => row.id),
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
