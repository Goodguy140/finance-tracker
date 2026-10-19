import type { AccountType } from "@prisma/client";
import { isEmergencyFundAccount, type FinancialScore } from "@/lib/financial-score";
import { ymdFromDateUtc } from "@/lib/date-only";
import type { GapTransferTx } from "./gaps";
import { MONTHLY_FACTOR, type RecurringCandidate } from "./recurring-detection";
import type { Insight, InsightTx } from "./types";
import { DAY_MS, daysBetween, displayTextFor, evidenceIds, ymOf, type MoneyFormatter } from "./util";

/**
 * Gaps in the log that would move the financial score if they were filled, as "Possible gaps"
 * insights. `gaps.ts` looks for entries that seem to be missing; these look at what the score
 * reads and where it is reading the wrong thing:
 *
 * - The emergency fund takes each account's latest balance, however old, and skips an account
 *   with none. A balance is only stale when the account has been used since it was read: a
 *   dormant account's last balance is still its balance.
 * - Fixed bills counts recurring rules only, so a bill the app has noticed but nobody set up
 *   makes that factor look lighter than it is.
 * - A card payment or a move between accounts booked as spending or income counts toward both,
 *   when the score leaves transfers out.
 * - Once any account counts as savings, the savings rate is what reached those accounts by
 *   transfer. A transfer with no destination, or regular transfers into an account that is not
 *   marked, are savings it cannot see.
 *
 * Only the months the score covers are looked at, and nothing here is said without a score.
 */

export type ScoreGapAccount = {
  id: string;
  name: string;
  type: AccountType | string;
  countsAsSavings: boolean;
  /** Latest balance reading on or before today; null when there is none. */
  latest: { cents: number; date: Date } | null;
};

export type ScoreGapsInput = {
  score: FinancialScore;
  /** Income and expenses in the home currency. */
  txs: InsightTx[];
  /** Transfer legs in the home currency. */
  transfers: GapTransferTx[];
  /** Active accounts in the home currency. */
  accounts: ScoreGapAccount[];
  candidates: RecurringCandidate[];
  now: Date;
  fmt: MoneyFormatter;
};

export function detectScoreGaps(input: ScoreGapsInput): Insight[] {
  const { score } = input;
  if (score.status !== "scored") return [];
  const months = new Set(score.months);
  const scoped = {
    ...input,
    months,
    txs: input.txs.filter((tx) => months.has(ymOf(tx.date))),
    transfers: input.transfers.filter((tx) => months.has(ymOf(tx.date))),
  };
  return [
    ...balanceGaps(input),
    ...untrackedBills(input),
    ...transferLikeEntries(scoped),
    ...unseenSavings(scoped),
  ];
}

const listWords = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

function shortDate(date: Date, now: Date): string {
  return date.toLocaleDateString("en-CA", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    ...(date.getUTCFullYear() === now.getUTCFullYear() ? {} : { year: "numeric" }),
  });
}

// --- Emergency fund balances -----------------------------------------------------------------

/** A reading older than this, with entries after it, no longer says what the account holds. */
export const STALE_BALANCE_DAYS = 45;

function balanceGaps({ accounts, txs, transfers, now }: ScoreGapsInput): Insight[] {
  const latestEntry = new Map<string, Date>();
  for (const tx of [...txs, ...transfers]) {
    if (!tx.accountId || tx.date > now) continue;
    const seen = latestEntry.get(tx.accountId);
    if (!seen || tx.date > seen) latestEntry.set(tx.accountId, tx.date);
  }

  const missing: ScoreGapAccount[] = [];
  const stale: ScoreGapAccount[] = [];
  for (const account of accounts) {
    if (!isEmergencyFundAccount(account)) continue;
    const used = latestEntry.get(account.id);
    if (!used) continue;
    if (!account.latest) missing.push(account);
    else if (daysBetween(account.latest.date, now) > STALE_BALANCE_DAYS && used > account.latest.date) stale.push(account);
  }
  if (missing.length === 0 && stale.length === 0) return [];

  const parts: string[] = [];
  if (stale.length) {
    parts.push(
      `${listWords(stale.map((a) => `${a.name}'s balance is from ${shortDate(a.latest!.date, now)}`))}, and ` +
        `${stale.length === 1 ? "the account has" : "those accounts have"} been used since.`,
    );
  }
  if (missing.length) {
    parts.push(
      `${listWords(missing.map((a) => a.name))} ${missing.length === 1 ? "has" : "have"} no balance at all, so ` +
        `${missing.length === 1 ? "it is" : "they are"} left out.`,
    );
  }
  const names = [...stale, ...missing];
  return [
    {
      // The reading dates are part of the key: a fresh balance that goes stale again asks again.
      key: `gap:score-balance:${names.map((a) => `${a.id}@${a.latest ? ymdFromDateUtc(a.latest.date) : "none"}`).sort().join(",")}`,
      section: "gap",
      severity: "medium",
      title:
        names.length === 1
          ? `Your emergency fund reads ${missing.length ? "no" : "an old"} balance for ${names[0].name}`
          : `Your emergency fund reads old or missing balances for ${names.length} accounts`,
      body: `${parts.join(" ")} Entering today's balance keeps the emergency fund part of your score accurate.`,
      evidenceTxIds: [],
      action: { kind: "link", href: "/settings/accounts", label: "Update balances" },
    },
  ];
}

// --- Bills that are not set up -----------------------------------------------------------------

/** Below this a month, untracked bills would barely move the factor. */
const MIN_UNTRACKED_BILLS_CENTS = 1_000;

function untrackedBills({ score, candidates, fmt }: ScoreGapsInput): Insight[] {
  if (score.status !== "scored") return [];
  const bills = candidates
    // A monthly card payment booked as spending is the transfer insight's, not a bill.
    .filter((c) => c.type === "EXPENSE" && c.medianAmountCents > 0 && !c.txs.some(looksLikeOwnTransfer))
    .map((c) => ({ label: c.label, cents: Math.round(c.medianAmountCents * MONTHLY_FACTOR[c.cadence]), txs: c.txs }))
    .sort((a, b) => b.cents - a.cents || a.label.localeCompare(b.label));
  const total = bills.reduce((s, b) => s + b.cents, 0);
  if (total < MIN_UNTRACKED_BILLS_CENTS) return [];

  const tracked = score.factors.find((f) => f.id === "bills");
  const shown = bills.slice(0, 3).map((b) => b.label);
  const rest = bills.length - shown.length;
  return [
    {
      key: "gap:score-bills",
      section: "gap",
      severity: "low",
      title: `${bills.length === 1 ? "A bill isn't" : `${bills.length} bills aren't`} counted in your fixed bills`,
      body:
        `${listWords(rest > 0 ? [...shown, `${rest} more`] : shown)} look${bills.length === 1 ? "s" : ""} like ` +
        `${bills.length === 1 ? "a regular bill" : "regular bills"}, about ${fmt(total)} a month, but ` +
        (tracked
          ? "the fixed bills part of your score only counts recurring entries you have set up, so it reads lighter than it is."
          : "with no recurring bills set up, your score leaves fixed bills out altogether.") +
        " Tracking them under Recurring charges we noticed counts them.",
      monthlyCents: total,
      evidenceTxIds: evidenceIds(bills.flatMap((b) => b.txs.slice(-2)), 6),
      action: { kind: "link", href: "/insights#insights-recurring", label: "See the charges" },
    },
  ];
}

// --- Transfers booked as spending or income ---------------------------------------------------

/**
 * Wording a bank or a person uses for money moving between their own accounts. Kept narrow on
 * purpose: an e-transfer to someone else is real spending.
 */
const OWN_TRANSFER_TEXT =
  /\b(payment\s*[-–—]?\s*thank\s*you|paiement\s*[-–—]?\s*merci|(credit\s*)?card\s*payment|cc\s*payment|internal\s*transfer|transfer\s+(to|from)\s+(my\s+)?(savings|chequing|checking|tfsa|rrsp|fhsa|visa|mastercard|amex)|(to|from)\s+savings\s+(account|acct)|e-?transfer\s+(to|from)\s+(self|myself|own))\b/i;

/** Plaid's own word for the same: a card payment or a move between the user's accounts. */
const OWN_TRANSFER_PFC = new Set([
  "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
  "TRANSFER_IN_ACCOUNT_TRANSFER",
  "TRANSFER_OUT_ACCOUNT_TRANSFER",
]);

/** How far apart the two sides of one movement can be dated. */
const MIRROR_DAYS = 3;

export function looksLikeOwnTransfer(tx: Pick<InsightTx, "title" | "merchantName" | "pfcDetailed">): boolean {
  return (tx.pfcDetailed != null && OWN_TRANSFER_PFC.has(tx.pfcDetailed)) || OWN_TRANSFER_TEXT.test(displayTextFor(tx));
}

/**
 * Expenses and income that look like money moving between the user's own accounts: worded
 * like it, or an expense in one account with income of the same amount in another a few days
 * either side. Refunds (negative amounts) are never a transfer.
 */
export function findTransferLikeEntries(txs: readonly InsightTx[]): InsightTx[] {
  const found = new Map<string, InsightTx>();
  for (const tx of txs) if (tx.amountCents > 0 && looksLikeOwnTransfer(tx)) found.set(tx.id, tx);

  const income = txs.filter((tx) => tx.type === "INCOME" && tx.amountCents > 0 && tx.accountId);
  const used = new Set<string>();
  for (const out of txs) {
    if (out.type !== "EXPENSE" || out.amountCents <= 0 || !out.accountId) continue;
    const match = income.find(
      (inc) =>
        !used.has(inc.id) &&
        inc.amountCents === out.amountCents &&
        inc.accountId !== out.accountId &&
        Math.abs(inc.date.getTime() - out.date.getTime()) <= MIRROR_DAYS * DAY_MS,
    );
    if (!match) continue;
    used.add(match.id);
    found.set(out.id, out);
    found.set(match.id, match);
  }
  return [...found.values()].sort((a, b) => a.date.getTime() - b.date.getTime() || a.id.localeCompare(b.id));
}

function transferLikeEntries({ txs, fmt }: ScoreGapsInput): Insight[] {
  const found = findTransferLikeEntries(txs);
  if (found.length === 0) return [];
  const spent = found.filter((tx) => tx.type === "EXPENSE").reduce((s, tx) => s + tx.amountCents, 0);
  const earned = found.filter((tx) => tx.type === "INCOME").reduce((s, tx) => s + tx.amountCents, 0);
  const effects: string[] = [];
  if (spent > 0) effects.push(`${fmt(spent)} counted as spending`);
  if (earned > 0) effects.push(`${fmt(earned)} counted as income`);
  const latest = found[found.length - 1];
  return [
    {
      // The newest entry is part of the key: a new one asks again after a dismissal.
      key: `gap:score-transfer-like:${latest.id}`,
      section: "gap",
      severity: spent + earned >= 50_000 ? "medium" : "low",
      title: `${found.length === 1 ? "An entry looks" : `${found.length} entries look`} like a transfer between your accounts`,
      body:
        `${found.length === 1 ? "It reads like" : "They read like"} a card payment or money moved between your own accounts, ` +
        `but ${effects.join(" and ")}. Your score leaves transfers out, so ` +
        `${spent > 0 ? "these make your savings rate read low" : "these make your income read high"}. ` +
        "Open each one and choose Mark as transfer if that is what it was.",
      evidenceTxIds: evidenceIds(found, 6),
      action: { kind: "link", href: `/?month=${ymOf(latest.date)}`, label: "Open that month" },
    },
  ];
}

// --- Savings the score cannot see -------------------------------------------------------------

/** Account kinds money is never saved into. */
const NEVER_SAVINGS: ReadonlySet<string> = new Set(["CREDIT_CARD", "LOAN", "PROPERTY"]);
/** Months with money moving in before an unmarked account looks like where savings go. */
const MIN_SAVING_MONTHS = 2;
/** Below this, a transfer with no destination is not worth asking about. */
const MIN_UNKNOWN_DESTINATION_CENTS = 5_000;

function unseenSavings({ score, txs, transfers, accounts, fmt, months }: ScoreGapsInput & { months: Set<string> }): Insight[] {
  if (score.status !== "scored") return [];
  const savingsIds = new Set(accounts.filter((a) => a.countsAsSavings).map((a) => a.id));
  // With nothing marked, the savings rate is income less spending, and every transfer is
  // already inside it.
  if (savingsIds.size === 0) return [];
  const out: Insight[] = [];

  // Transfers out of a spending account that name no destination.
  const unnamed = transfers.filter(
    (tx) => tx.amountCents > 0 && !tx.paired && tx.transferAccountId === null && tx.accountId !== null && !savingsIds.has(tx.accountId),
  );
  const unnamedCents = unnamed.reduce((s, tx) => s + tx.amountCents, 0);
  if (unnamedCents >= MIN_UNKNOWN_DESTINATION_CENTS) {
    const latest = unnamed[unnamed.length - 1];
    out.push({
      key: `gap:score-transfer-to:${latest.id}`,
      section: "gap",
      severity: "low",
      title: `${unnamed.length === 1 ? "A transfer doesn't" : `${unnamed.length} transfers don't`} say where the money went`,
      body:
        `${fmt(unnamedCents)} left your accounts by transfer with no account on the other side. Your savings rate counts ` +
        "what reaches your savings accounts, so if any of it went there, naming the account counts it.",
      evidenceTxIds: evidenceIds(unnamed, 6),
      action: { kind: "link", href: `/?month=${ymOf(latest.date)}`, label: "Open that month" },
    });
  }

  // Money that keeps arriving in an unmarked account and is never spent from it.
  const spentFrom = new Set(txs.filter((tx) => tx.type === "EXPENSE" && tx.accountId).map((tx) => tx.accountId as string));
  for (const account of accounts) {
    if (account.countsAsSavings || NEVER_SAVINGS.has(account.type) || spentFrom.has(account.id)) continue;
    const byMonth = new Map<string, number>();
    const legs: GapTransferTx[] = [];
    for (const tx of transfers) {
      let cents = 0;
      if (tx.accountId === account.id) cents = -tx.amountCents;
      else if (tx.transferAccountId === account.id && !tx.paired) cents = tx.amountCents;
      if (cents === 0) continue;
      legs.push(tx);
      const ym = ymOf(tx.date);
      byMonth.set(ym, (byMonth.get(ym) ?? 0) + cents);
    }
    const net = [...byMonth.values()].reduce((s, c) => s + c, 0);
    const inMonths = [...byMonth.values()].filter((c) => c > 0).length;
    if (net <= 0 || inMonths < MIN_SAVING_MONTHS) continue;
    const perMonth = Math.round(net / months.size);
    out.push({
      key: `gap:score-savings-account:${account.id}`,
      section: "gap",
      severity: "medium",
      title: `Money moved into ${account.name} isn't counted as saved`,
      body:
        `About ${fmt(perMonth)} a month moved into ${account.name} and stayed there, but the account isn't marked ` +
        `“Counts as savings”, so your savings rate leaves it out. If it is savings, mark it under Settings, Accounts.`,
      monthlyCents: perMonth,
      evidenceTxIds: evidenceIds(legs, 6),
      action: { kind: "link", href: "/settings/accounts", label: "Open accounts" },
    });
  }
  return out;
}
