import type { TransactionType } from "@prisma/client";
import { MATCH_DATE_TOLERANCE_DAYS, bestDateDelta } from "@/lib/plaid/matcher";
import { outflowCents } from "@/lib/transfer-type";

/**
 * Proposing which two bank rows are the two sides of one transfer.
 *
 * With both banks linked, a credit-card payment arrives twice: once leaving chequing and
 * once reaching the card. Each is a transfer on its own, but only together do they say
 * where the money went. The review queue offers to add the pair as two linked transfer
 * legs, each carrying the other's account.
 *
 * The rules mirror the matcher's: a suggestion only, confirmed by a person, so it may be a
 * heuristic, but it must be deterministic. Pure: no Prisma, no clock.
 */

export type PairableStaged = {
  id: string;
  /** The app Account the row's Plaid account maps onto; null when unmapped. */
  accountId: string | null;
  type: TransactionType;
  /** As staged: income positive, expenses and transfers positive for money out. */
  amountCents: number;
  date: Date;
  postedDate: Date | null;
};

/** How far apart the two sides may be dated. Interbank moves settle over a few days. */
export const TRANSFER_PAIR_DATE_TOLERANCE_DAYS = MATCH_DATE_TOLERANCE_DAYS;

/**
 * Whether two staged rows can be the two sides of one transfer, and how far apart they are
 * dated when they can.
 *
 * Both must be on mapped accounts, and different ones: a transfer from an account to itself
 * is a reversal, not a transfer. The money must leave one and arrive in the other in exactly
 * the same amount; banks do not round a transfer, so any difference means two unrelated
 * rows. And the sync must have taken at least one side for a transfer, which keeps a $50
 * purchase on the card from pairing with an unrelated $50 deposit the same week.
 */
export function transferPairDateDelta(a: PairableStaged, b: PairableStaged): number | null {
  if (a.id === b.id) return null;
  if (!a.accountId || !b.accountId || a.accountId === b.accountId) return null;
  if (a.type !== "TRANSFER" && b.type !== "TRANSFER") return null;
  const out = outflowCents(a.type, a.amountCents);
  if (out === 0 || out !== -outflowCents(b.type, b.amountCents)) return null;
  const delta = bestDateDelta(a, b);
  return Number.isFinite(delta) && delta <= TRANSFER_PAIR_DATE_TOLERANCE_DAYS ? delta : null;
}

/**
 * Pairs each row with at most one other, closest dates first.
 *
 * Returned both ways round (a → b and b → a), so the queue can look up either side. Two
 * $500 moves to savings a week apart each pair with their own arrival; when the dates
 * cannot tell them apart, ids decide, so the suggestion never reshuffles between loads.
 */
export function assignTransferPairs(rows: PairableStaged[]): Map<string, string> {
  const pairings: { a: PairableStaged; b: PairableStaged; delta: number; bothTransfers: boolean }[] = [];
  const sorted = [...rows].sort((x, y) => x.id.localeCompare(y.id));
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const delta = transferPairDateDelta(sorted[i], sorted[j]);
      if (delta === null) continue;
      pairings.push({
        a: sorted[i],
        b: sorted[j],
        delta,
        bothTransfers: sorted[i].type === "TRANSFER" && sorted[j].type === "TRANSFER",
      });
    }
  }

  pairings.sort(
    (x, y) =>
      x.delta - y.delta ||
      Number(y.bothTransfers) - Number(x.bothTransfers) ||
      x.a.id.localeCompare(y.a.id) ||
      x.b.id.localeCompare(y.b.id),
  );

  const paired = new Map<string, string>();
  for (const { a, b } of pairings) {
    if (paired.has(a.id) || paired.has(b.id)) continue;
    paired.set(a.id, b.id);
    paired.set(b.id, a.id);
  }
  return paired;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The period's date filter, widened so a row near the edge can find a partner just outside
 * it: a card paid on the 30th usually shows the payment arriving on the 1st.
 */
type DateFilter = { date: { gte: Date; lt: Date } } | Record<string, never>;

export function widenDateFilterForPairing(filter: DateFilter): DateFilter {
  if (!("date" in filter)) return {};
  const pad = TRANSFER_PAIR_DATE_TOLERANCE_DAYS * DAY_MS;
  return {
    date: { gte: new Date(filter.date.gte.getTime() - pad), lt: new Date(filter.date.lt.getTime() + pad) },
  };
}
