import type { TransactionType } from "@prisma/client";
import { normalizeMerchant } from "@/lib/plaid/merchant-text";

/**
 * Proposing which hand-entered transaction a bank record corresponds to.
 *
 * This decides what the review queue pre-selects, not what gets written: every row is
 * confirmed by a human, except an exact, unambiguous match (`selectAutoLinks`), which only
 * verifies a row the user entered. That is what licenses a heuristic here — but it has to be
 * *deterministic*, because a suggestion that reshuffles between page loads is worse than
 * no suggestion, and because determinism is what makes the tests meaningful.
 *
 * Pure by construction: no Prisma, no clock, no I/O.
 */

export type MatchCandidate = {
  id: string;
  accountId: string | null;
  type: TransactionType;
  /** As stored: an expense may be negative when it is a refund. */
  amountCents: number;
  date: Date;
  postedDate: Date | null;
  title: string | null;
  /** Already linked to some bank record. A hard exclusion, not a penalty. */
  isVerified: boolean;
  /** Split parents can be linked to (the verification sits on the parent). */
  isSplitParent: boolean;
};

export type StagedForMatch = {
  id: string;
  /** The app Account this row's Plaid account maps onto; null when unmapped. */
  accountId: string | null;
  type: TransactionType;
  amountCents: number;
  date: Date;
  postedDate: Date | null;
  name: string;
  merchantName: string | null;
};

export type MatchTier = "high" | "low";

export type MatchResult = {
  transactionId: string;
  score: number;
  tier: MatchTier;
  reasons: string[];
};

export const MATCH_DATE_TOLERANCE_DAYS = 4;
export const MATCH_HIGH_SCORE = 75;
export const MATCH_LOW_SCORE = 45;

/**
 * General tolerance for two amounts being "the same": rounding, a cash-back line, minor
 * FX noise. Deliberately tight.
 */
export const MATCH_AMOUNT_ABS_TOLERANCE_CENTS = 100;
export const MATCH_AMOUNT_REL_TOLERANCE = 0.02;

/**
 * A separate, much wider allowance for the restaurant-tip case, applied in one direction
 * only.
 *
 * A diner records what the meal cost; the bank later posts the total including the tip, so
 * the bank amount is *higher* and by far more than any rounding band would permit — a 15%
 * tip on $47 is $7.05, where 2% is $0.94. A symmetric band that wide would pair genuinely
 * unrelated transactions, so this applies only when the bank side exceeds the recorded
 * side, which is the only direction a tip can move it. A tip match never reaches the
 * `high` tier: the queue shows the difference and asks.
 */
export const MATCH_TIP_MAX_RATIO = 0.3;

export function amountToleranceCents(amountCents: number): number {
  return Math.max(
    MATCH_AMOUNT_ABS_TOLERANCE_CENTS,
    Math.round(Math.abs(amountCents) * MATCH_AMOUNT_REL_TOLERANCE),
  );
}

export type AmountRelation =
  | { ok: true; kind: "exact"; deltaCents: 0 }
  | { ok: true; kind: "near"; deltaCents: number }
  | { ok: true; kind: "tip"; deltaCents: number; ratio: number }
  | { ok: false };

/**
 * Decides whether a bank amount and a recorded amount can be the same transaction.
 *
 * `stagedCents` is the bank's figure, `candidateCents` what the user typed. Both are
 * signed as stored, so a refund is negative on both sides.
 */
export function compareAmounts(stagedCents: number, candidateCents: number): AmountRelation {
  // Money in never matches money out, whatever the magnitudes. Linking a refund to a
  // purchase of the same size would cancel two real rows against each other.
  if (Math.sign(stagedCents) !== Math.sign(candidateCents)) return { ok: false };

  const delta = Math.abs(stagedCents - candidateCents);
  if (delta === 0) return { ok: true, kind: "exact", deltaCents: 0 };
  if (delta <= amountToleranceCents(stagedCents)) {
    return { ok: true, kind: "near", deltaCents: delta };
  }

  // Tip: outflow only, and only where the bank charged more than was recorded.
  const bankChargedMore = stagedCents > candidateCents;
  if (stagedCents > 0 && candidateCents > 0 && bankChargedMore) {
    const ratio = delta / candidateCents;
    if (ratio <= MATCH_TIP_MAX_RATIO) {
      return { ok: true, kind: "tip", deltaCents: delta, ratio };
    }
  }

  return { ok: false };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dayDelta(a: Date, b: Date): number {
  return Math.round(Math.abs(a.getTime() - b.getTime()) / DAY_MS);
}

/**
 * Smallest gap between any pairing of the two rows' dates.
 *
 * Both sides carry a transaction date and a posted date, and people date a purchase from
 * when they made it while the bank often dates it from when it settled. Comparing only
 * `date` to `date` would miss the common weekend-purchase-posts-Monday case.
 */
export function bestDateDelta(staged: StagedForMatch, candidate: MatchCandidate): number {
  const stagedDates = [staged.date, staged.postedDate].filter((d): d is Date => Boolean(d));
  const candidateDates = [candidate.date, candidate.postedDate].filter((d): d is Date => Boolean(d));
  let best = Number.POSITIVE_INFINITY;
  for (const s of stagedDates) {
    for (const c of candidateDates) {
      best = Math.min(best, dayDelta(s, c));
    }
  }
  return best;
}

function bigrams(value: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < value.length - 1; i++) out.push(value.slice(i, i + 2));
  return out;
}

/**
 * Dice coefficient over character bigrams, 0..1.
 *
 * Chosen over edit distance because it is length-tolerant: a short user title ("Netflix")
 * against a long bank description ("NETFLIX.COM 866-579-7172") should still score well,
 * where Levenshtein would be dominated by the length difference.
 */
export function merchantSimilarity(a: string, b: string): number {
  const x = normalizeMerchant(a);
  const y = normalizeMerchant(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return x === y ? 1 : 0;

  const xs = bigrams(x);
  const ys = bigrams(y);
  const pool = new Map<string, number>();
  for (const g of xs) pool.set(g, (pool.get(g) ?? 0) + 1);

  let hits = 0;
  for (const g of ys) {
    const left = pool.get(g) ?? 0;
    if (left > 0) {
      pool.set(g, left - 1);
      hits++;
    }
  }
  return (2 * hits) / (xs.length + ys.length);
}

/** The best description available for a staged row. */
export function stagedDescription(staged: StagedForMatch): string {
  return staged.merchantName?.trim() || staged.name || "";
}

/**
 * Scores one pairing, or returns null when they cannot be the same transaction.
 *
 * The gates are absolute rather than heavy penalties: a mismatch on any of them means the
 * pairing is impossible, and letting a high merchant similarity outvote that would be how
 * a plausible-looking wrong suggestion reaches the user.
 */
export function scoreMatch(
  staged: StagedForMatch,
  candidate: MatchCandidate,
  opts: { dateToleranceDays?: number } = {},
): MatchResult | null {
  // Already linked to another bank record. One bank record, one transaction.
  if (candidate.isVerified) return null;
  if (candidate.type !== staged.type) return null;
  if (staged.accountId && candidate.accountId && staged.accountId !== candidate.accountId) {
    return null;
  }

  const amounts = compareAmounts(staged.amountCents, candidate.amountCents);
  if (!amounts.ok) return null;

  const toleranceDays = opts.dateToleranceDays ?? MATCH_DATE_TOLERANCE_DAYS;
  const dateDelta = bestDateDelta(staged, candidate);
  if (!Number.isFinite(dateDelta) || dateDelta > toleranceDays) return null;

  const reasons: string[] = [];
  let score = 0;

  const amountExact = amounts.kind === "exact";
  if (amounts.kind === "exact") {
    score += 50;
    reasons.push("exact amount");
  } else if (amounts.kind === "near") {
    score += 30;
    reasons.push(`amount differs by ${(amounts.deltaCents / 100).toFixed(2)}`);
  } else {
    // Weakest of the three: plausible, but the one most worth a human glance.
    score += 25;
    reasons.push(
      `bank is ${(amounts.deltaCents / 100).toFixed(2)} higher (${Math.round(amounts.ratio * 100)}%) — tip?`,
    );
  }

  if (staged.accountId && candidate.accountId && staged.accountId === candidate.accountId) {
    score += 20;
    reasons.push("same account");
  } else if (!candidate.accountId) {
    // A transaction whose account was removed is weak evidence, not a contradiction.
    score += 5;
    reasons.push("no account on record");
  }

  const dateScore = [25, 20, 15, 10, 5][dateDelta] ?? 0;
  score += dateScore;
  reasons.push(dateDelta === 0 ? "same day" : `${dateDelta} day${dateDelta === 1 ? "" : "s"} apart`);

  const similarity = merchantSimilarity(stagedDescription(staged), candidate.title ?? "");
  if (similarity > 0) {
    score += Math.round(25 * similarity);
    reasons.push(`merchant ${similarity.toFixed(2)}`);
  }

  if (score < MATCH_LOW_SCORE) return null;

  // `high` is what pre-selects Link, so it demands all three of a strong score, an exact
  // amount, and near-identical dates. An approximate amount stays `low` however well the
  // merchant name matches — the user should see the difference and decide.
  const tier: MatchTier =
    score >= MATCH_HIGH_SCORE && amountExact && dateDelta <= 2 ? "high" : "low";

  return { transactionId: candidate.id, score, tier, reasons };
}

type Pairing = {
  stagedId: string;
  candidateId: string;
  result: MatchResult;
  dateDelta: number;
  amountDelta: number;
};

/**
 * Assigns at most one candidate to each staged row, and each candidate at most once.
 *
 * The one-to-one part is the bit that is easy to forget and obvious in hindsight: two
 * $12.00 coffees on the same day would otherwise both propose the same existing row, and
 * accepting both would link one transaction twice while leaving the other unexplained.
 *
 * Greedy rather than globally optimal. It is deterministic, O(n·m log n·m), and every row
 * is reviewed by a human anyway — a Hungarian-algorithm implementation would be
 * unjustifiable complexity for a suggestion someone is about to confirm.
 */
export function assignMatches(
  staged: StagedForMatch[],
  candidates: MatchCandidate[],
  opts: { dateToleranceDays?: number } = {},
): Map<string, MatchResult> {
  const pairings: Pairing[] = [];

  for (const row of staged) {
    for (const candidate of candidates) {
      const result = scoreMatch(row, candidate, opts);
      if (!result) continue;
      pairings.push({
        stagedId: row.id,
        candidateId: candidate.id,
        result,
        dateDelta: bestDateDelta(row, candidate),
        amountDelta: Math.abs(candidate.amountCents - row.amountCents),
      });
    }
  }

  // Deterministic ordering, strongest first. The final id comparisons are what make the
  // outcome stable when two pairings are otherwise indistinguishable.
  pairings.sort(
    (a, b) =>
      b.result.score - a.result.score ||
      a.dateDelta - b.dateDelta ||
      a.amountDelta - b.amountDelta ||
      a.candidateId.localeCompare(b.candidateId) ||
      a.stagedId.localeCompare(b.stagedId),
  );

  const assigned = new Map<string, MatchResult>();
  const claimedCandidates = new Set<string>();
  for (const pairing of pairings) {
    if (assigned.has(pairing.stagedId)) continue;
    if (claimedCandidates.has(pairing.candidateId)) continue;
    assigned.set(pairing.stagedId, pairing.result);
    claimedCandidates.add(pairing.candidateId);
  }
  return assigned;
}

/**
 * Which of the matcher's assignments are certain enough to link without asking.
 *
 * When the bank reports exactly the amount the user entered, there is nothing for a
 * person to weigh, so the pairing is linked and verified during the sync. That is the
 * only thing written without review: the user's own row is left as they entered it, and
 * a new transaction is never created this way.
 *
 * Everything else still waits for a person, and so does an exact match that is not the
 * only one it could be — two $12.00 coffees on consecutive days pair exactly with either
 * recorded coffee, and picking one silently is the wrong-link case with no undo. A
 * pending row waits for its posted successor, since a pending amount can still move (the
 * tip, again).
 */
export function selectAutoLinks(
  staged: (StagedForMatch & { isPending: boolean })[],
  candidates: MatchCandidate[],
  assigned: Map<string, MatchResult>,
  opts: { dateToleranceDays?: number } = {},
): Set<string> {
  const isExactPairing = (row: StagedForMatch, candidate: MatchCandidate) =>
    row.amountCents === candidate.amountCents && scoreMatch(row, candidate, opts) !== null;

  const stagedById = new Map(staged.map((row) => [row.id, row]));
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const auto = new Set<string>();

  for (const [stagedId, match] of assigned) {
    const row = stagedById.get(stagedId);
    const candidate = candidateById.get(match.transactionId);
    if (!row || !candidate || row.isPending) continue;
    if (!isExactPairing(row, candidate)) continue;

    const rivalCandidate = candidates.some(
      (other) => other.id !== candidate.id && isExactPairing(row, other),
    );
    const rivalStaged = staged.some((other) => other.id !== row.id && isExactPairing(other, candidate));
    if (rivalCandidate || rivalStaged) continue;

    auto.add(stagedId);
  }
  return auto;
}
