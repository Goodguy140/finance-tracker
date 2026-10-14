"use client";

import { useId, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Ellipsis } from "lucide-react";
import { ServerActionForm } from "@/components/server-action-form";
import { InlineTags, MetaChip } from "@/components/meta-chip";
import { primaryBtnClass, secondaryBtnClass } from "@/components/forms/shared";
import {
  CategoryDot,
  MetaParts,
  TransactionDayHeader,
  TransactionMetaLine,
} from "@/components/transaction-rows";
import { groupTransactionsByDay } from "@/lib/transaction-day-groups";
import type { CardDensity } from "@/lib/dashboard-layout/schema";
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
  dateYmd: string;
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
  /** The rows on screen: the newest page or pages of the queue. */
  rows: ReviewRow[];
  /** Every row waiting for review in the period, shown or not. */
  totalCount: number;
  /** The `?queue=` value that shows the next page; null when every row is shown. */
  nextLimit: number | null;
  revisions: RevisionRow[];
  /** The Expense Log card's density, which the queue sits inside and follows. */
  density?: CardDensity;
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

const choiceBtnClass =
  "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40";
const actionBtnClass =
  "shrink-0 touch-manipulation rounded-lg border px-2.5 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40";

function ReviewQueueRow({ row, density }: { row: ReviewRow; density: CardDensity | undefined }) {
  // Pre-selection follows the matcher's confidence: a strong match proposes Link, anything
  // weaker proposes Add and keeps the candidate in view so the user can switch to it.
  // A pair beats a weak match: two bank rows agreeing to the cent on opposite sides is
  // stronger evidence than a hand-entered row that only roughly fits.
  const [decision, setDecision] = useState<"link" | "pair" | "add">(
    row.match?.tier === "high" ? "link" : row.transferPair ? "pair" : "add",
  );
  const [asTransfer, setAsTransfer] = useState(row.isTransfer);
  const [categoryId, setCategoryId] = useState(row.suggestedCategoryId);
  const [showOptions, setShowOptions] = useState(false);
  const optionsId = useId();
  // What the chosen decision would write. Linking keeps the entry the user already made, so
  // rules only come into it when the row is added or paired.
  const committed =
    decision === "pair" ? row.asTransfer : decision === "add" ? (asTransfer ? row.asTransfer : row.asNonTransfer) : null;
  const shown = committed ?? (row.isTransfer ? row.asTransfer : row.asNonTransfer);
  const renamed = shown.title !== row.bankName;
  const bookedAsTransfer = decision === "pair" || (decision === "add" && asTransfer);
  const pad = density === "compact" ? "py-1.5" : "py-2.5";

  const transferDirection = row.transferPair
    ? row.transferPair.outflow
      ? `${row.accountLabel} → ${row.transferPair.accountLabel}`
      : `${row.transferPair.accountLabel} → ${row.accountLabel}`
    : null;

  return (
    <li className={`space-y-1.5 px-2 ${pad}`} data-testid="review-queue-row">
      <div className="flex items-start gap-2.5">
        <CategoryDot categoryIds={bookedAsTransfer || decision === "link" ? [] : [categoryId]} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium leading-snug text-slate-100">{shown.title}</span>
          <TransactionMetaLine density={density} title={[renamed ? row.bankName : null, row.accountLabel].filter(Boolean).join(" · ")}>
            <MetaParts
              parts={[
                renamed ? row.bankName : null,
                row.accountLabel,
                row.isTransfer ? "transfer" : null,
                row.isPending ? "pending" : null,
                committed?.reason === "rule"
                  ? "filled in by your rules"
                  : committed?.reason === "learned"
                    ? "category from a past entry"
                    : null,
                committed?.note ? (
                  <span data-testid="review-rule-extras">{committed.note}</span>
                ) : null,
              ]}
            />
            {committed ? <InlineTags tags={committed.tagNames} /> : null}
          </TransactionMetaLine>
        </span>
        <span className="shrink-0 text-sm font-semibold tabular-nums">
          <AmountText cents={row.amountCents} />
        </span>
      </div>

      {row.match && (decision === "link" || !row.transferPair) ? (
        <p className="pl-5 text-xs leading-snug text-slate-400">
          <span className="text-sky-300/90">Looks like</span>{" "}
          <span className="font-medium text-slate-200">{row.match.candidate.title}</span>
          <span className="text-slate-500">
            {" "}
            · {formatCurrency(Math.abs(row.match.candidate.amountCents))} · {row.match.candidate.dateDisplay}
            {row.match.reasons.length > 0 ? ` · ${row.match.reasons.join(", ")}` : ""}
          </span>
        </p>
      ) : null}
      {row.transferPair && decision !== "link" ? (
        <p className="pl-5 text-xs leading-snug text-slate-400">
          <span className="text-sky-300/90">Looks like the other side of a transfer:</span>{" "}
          <span className="font-medium text-slate-200">{row.transferPair.heading}</span>
          <span className="text-slate-500">
            {" "}
            · {row.transferPair.accountLabel} · {row.transferPair.dateDisplay}
          </span>
        </p>
      ) : null}

      <div className="flex items-center gap-1.5 pl-5" role="group" aria-label={`What to do with ${row.heading}`}>
        <ServerActionForm
          action={decision === "pair" ? pairStagedTransfersAction : resolveStagedTransactionAction}
          className="flex min-w-0 flex-1 items-center gap-1.5"
        >
          <input type="hidden" name="stagedId" value={row.id} />
          <input type="hidden" name="decision" value={decision} />
          {decision === "link" && row.match ? (
            <input type="hidden" name="linkTransactionId" value={row.match.candidate.id} />
          ) : null}
          {decision === "pair" && row.transferPair ? (
            <input type="hidden" name="peerStagedId" value={row.transferPair.stagedId} />
          ) : null}
          {decision === "add" ? (
            <input type="hidden" name="countAs" value={asTransfer ? "TRANSFER" : row.nonTransferType} />
          ) : null}

          <span className="min-w-0 flex-1">
            {decision === "add" && !asTransfer ? (
              <select
                name="categoryId"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="h-7 w-full max-w-[13rem] truncate rounded-lg border border-slate-700/80 bg-slate-900/70 px-2 text-xs text-slate-200 focus:border-blue-500 focus:outline-none"
                aria-label={`Category for ${row.heading}`}
              >
                {row.categoryOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="block truncate text-xs text-slate-500">
                {decision === "link"
                  ? "Verifies the entry you already made"
                  : decision === "pair"
                    ? `${transferDirection} · one transfer`
                    : "Transfer · not counted as spending or income"}
              </span>
            )}
          </span>
          <button
            type="submit"
            className={`${actionBtnClass} border-blue-400/50 bg-blue-500/15 text-blue-100 hover:bg-blue-500/25`}
          >
            {decision === "link" ? "Link" : decision === "pair" ? "Pair" : "Add"}
          </button>
        </ServerActionForm>
        <ServerActionForm action={resolveStagedTransactionAction}>
          <input type="hidden" name="stagedId" value={row.id} />
          <input type="hidden" name="decision" value="ignore" />
          <button
            type="submit"
            className={`${actionBtnClass} border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800`}
          >
            Ignore
          </button>
        </ServerActionForm>
        <button
          type="button"
          aria-expanded={showOptions}
          aria-controls={optionsId}
          aria-label={`More options for ${row.heading}`}
          title="More options"
          onClick={() => setShowOptions((v) => !v)}
          className={`${actionBtnClass} px-1.5 ${
            showOptions
              ? "border-blue-400/50 bg-blue-500/15 text-blue-100"
              : "border-slate-700 bg-slate-900 text-slate-400 hover:bg-slate-800"
          }`}
        >
          <Ellipsis className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {showOptions ? (
        <div id={optionsId} className="ml-5 space-y-2 rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Choose how to add ${row.heading}`}>
            {(
              [
                ["link", "Link to existing"],
                ...(row.transferPair ? ([["pair", "Pair as transfer"]] as const) : []),
                ["add", "Add as new"],
              ] as const
            ).map(([value, label]) => {
              const active = decision === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={active}
                  disabled={value === "link" && !row.match}
                  onClick={() => setDecision(value)}
                  className={`${choiceBtnClass} ${
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
          ) : null}
          {decision === "pair" && transferDirection ? (
            <p className="text-xs text-slate-500">{transferDirection} · same amount, opposite sides. Both rows become one transfer.</p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function PlaidReviewQueue({ rows, totalCount, nextLimit, revisions, density }: PlaidReviewQueueProps) {
  const [open, setOpen] = useState(true);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const hiddenCount = Math.max(0, totalCount - rows.length);
  const unmatchedIds = useMemo(
    // A suggested transfer pair is left out: adding both sides on their own would lose the pair.
    () => rows.filter((row) => !row.match && !row.transferPair).map((row) => row.id),
    [rows],
  );
  const days = useMemo(() => groupTransactionsByDay(rows, (row) => row), [rows]);

  if (rows.length === 0 && revisions.length === 0) return null;

  return (
    <section className="space-y-3 rounded-2xl border border-blue-500/30 bg-blue-950/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold text-slate-100">From your bank</h2>
          <MetaChip label="To review">{String(totalCount)}</MetaChip>
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
                Add all {unmatchedIds.length} unmatched{hiddenCount > 0 ? " shown" : ""}
              </button>
            </ServerActionForm>
          ) : null}

          <div className="rounded-xl border border-slate-800 bg-slate-950/50 px-1 pb-1 pt-2" data-testid="review-queue-rows">
            {days.map((day) => (
              <section key={day.dateYmd} aria-label={day.dateDisplay}>
                <TransactionDayHeader dateDisplay={day.dateDisplay} />
                <ul className="divide-y divide-slate-800/50">
                  {day.items.map((row) => (
                    <ReviewQueueRow key={row.id} row={row} density={density} />
                  ))}
                </ul>
              </section>
            ))}
          </div>

          {nextLimit !== null ? (
            <div className="flex flex-wrap items-center gap-2" data-testid="review-queue-more">
              <p className="text-xs text-slate-400">
                Showing the newest {rows.length} of {totalCount}. {hiddenCount} older{" "}
                {hiddenCount === 1 ? "one is" : "ones are"} not shown yet.
              </p>
              <button
                type="button"
                className={secondaryBtnClass}
                onClick={() => {
                  const next = new URLSearchParams(searchParams.toString());
                  next.set("queue", String(nextLimit));
                  router.push(`${pathname}?${next.toString()}`, { scroll: false });
                }}
              >
                Show {Math.min(hiddenCount, nextLimit - rows.length)} more
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
