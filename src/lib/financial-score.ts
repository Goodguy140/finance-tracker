import { AccountType } from "@prisma/client";
import { selectActiveBudgetsByCategory } from "@/lib/active-budgets";
import { shiftYm } from "@/lib/dashboard-period";
import { categoryAmounts, isBankFee } from "@/lib/insights/facts";
import { MONTHLY_FACTOR } from "@/lib/insights/recurring-detection";
import { ymOf } from "@/lib/insights/util";
import type { ReportTx } from "@/lib/reports";

/**
 * The overall financial score shown on Insights and Reports: one 0–100 number built from the
 * factors the app can actually measure, each with its own sub-score and, for the weakest, one
 * concrete thing to change. Factors sit in four pillars, after the Financial Health Network's
 * FinHealth Score: Spend, Save, Borrow and Plan.
 *
 * Everything is worked out over full calendar months before the current one, so a month
 * that has only just started cannot drag the score down. Months before the user's first
 * recorded income or expense are not counted either: someone who started tracking two months
 * ago is scored on two months, not on four empty ones.
 *
 * A factor with nothing to go on (no budgets set, no earlier months to compare) is left out
 * and the others are reweighted, rather than scored as zero.
 *
 * The emergency fund is the latest balance of the accounts money could be drawn from at short
 * notice (`isEmergencyFundAccount`), measured in months of average spending. The aim is three
 * months, or six when income moves around a lot from month to month.
 *
 * Debt counts only when it is a problem: a credit card carrying a balance from month to month,
 * or a loan or mortgage getting less than its minimum payment. A card paid off each statement
 * and a loan paid on schedule leave the Borrow pillar out altogether. A mortgage payment is
 * housing, so it counts with the bills either way, as rent would.
 *
 * When any account counts as savings, the savings rate is what moved into those accounts by
 * transfer as a share of income (`savings-transfers.ts`), not income less spending.
 */

export const SCORE_LOOKBACK_MONTHS = 6;
/** Spending trend compares the latest half of the lookback with the half before it. */
const TREND_HALF = 3;
/** Budget adherence, loan payments and the cash buffer look at this many of the latest full months. */
const RECENT_MONTHS = 3;

/** Months of average spending the emergency fund aims to cover. */
export const EMERGENCY_FUND_TARGET_MONTHS = 3;
/** The aim when income moves around a lot from month to month. */
export const UNSTEADY_INCOME_TARGET_MONTHS = 6;
/** Monthly income whose standard deviation is above this share of its mean counts as unsteady. */
export const UNSTEADY_INCOME_VARIATION = 0.25;

/** A card balance carried beyond its recent charges by less than this is rounding, not debt. */
const MIN_CARRIED_CENTS = 5_000;
/** Card utilization above this share of the limit hurts a credit score (`HIGH_UTILIZATION_PCT`). */
const HIGH_UTILIZATION = 0.3;

export type FinancialScoreFactorId =
  | "savings"
  | "emergency"
  | "bills"
  | "budgets"
  | "trend"
  | "buffer"
  | "consistency"
  | "cards"
  | "loans"
  | "fees"
  | "networth"
  | "outlook"
  | "goals"
  | "longterm";

export type FinancialScorePillarId = "spend" | "save" | "borrow" | "plan";

export const PILLAR_LABELS: Record<FinancialScorePillarId, string> = {
  spend: "Spend",
  save: "Save",
  borrow: "Borrow",
  plan: "Plan",
};

/** Which pillar each factor belongs to. */
export const FACTOR_PILLAR: Record<FinancialScoreFactorId, FinancialScorePillarId> = {
  savings: "spend",
  bills: "spend",
  budgets: "spend",
  trend: "spend",
  buffer: "spend",
  consistency: "spend",
  emergency: "save",
  longterm: "save",
  cards: "borrow",
  loans: "borrow",
  fees: "borrow",
  networth: "plan",
  outlook: "plan",
  goals: "plan",
};

export type FinancialScoreFactor = {
  id: FinancialScoreFactorId;
  pillar: FinancialScorePillarId;
  label: string;
  /** 0–100. */
  score: number;
  /** Share of the overall score, after factors with no data are dropped (sums to 1). */
  weight: number;
  /** What was measured, in a few words: "18% of income saved". */
  detail: string;
  /** One thing to do about it; null when the factor is already strong. */
  suggestion: string | null;
};

export type FinancialScorePillar = {
  id: FinancialScorePillarId;
  label: string;
  /** Weighted average of its factors; null when none of them could be scored. */
  score: number | null;
  /** Share of the overall score (0 when it has no factors). */
  weight: number;
  /** Why a pillar has no score, when it has none. */
  note: string | null;
};

/** A factor that could not be scored, and why. */
export type FinancialScoreOmission = { label: string; reason: string };

export type FinancialScoreBand = "Strong" | "Good" | "Fair" | "Needs work" | "At risk";

/** How the score moved since the month before, from the saved monthly snapshots. */
export type FinancialScoreChange = {
  /** The earlier month, `YYYY-MM`. */
  fromMonth: string;
  fromScore: number;
  /** The factor whose score moved most, by points, when any did. */
  mover: { label: string; delta: number } | null;
};

export type FinancialScore =
  | {
      status: "scored";
      score: number;
      band: FinancialScoreBand;
      /** Full months the score is based on, oldest first. */
      months: string[];
      factors: FinancialScoreFactor[];
      /** The four pillars, always in Spend, Save, Borrow, Plan order. */
      pillars: FinancialScorePillar[];
      /** Suggestions from the weakest factors, weakest first (at most three). */
      suggestions: string[];
      /** Factors left out for lack of data. */
      omitted: FinancialScoreOmission[];
      /** What chequing and savings hold, and average monthly spending; null with no balances. */
      cushion: { fundCents: number; monthlySpendingCents: number } | null;
      /** Months of spending the emergency fund aims for: 3, or 6 with unsteady income. */
      emergencyTargetMonths: number;
      /** Months that ended with money left over, whether or not that factor is scored. */
      monthsInBlack: { positive: number; total: number };
      /** Income split 50/30/20-style into needs, wants and saved; null without category roles. */
      split: { needs: number; wants: number; saved: number } | null;
      /** Accounts in another currency whose entries or balance the score leaves out. */
      otherCurrencyAccounts: OtherCurrencyAccount[];
      /** Set by the loader from the saved snapshots; null with no earlier month saved. */
      change: FinancialScoreChange | null;
    }
  | { status: "insufficient"; reason: string };

export type OtherCurrencyAccount = { name: string; currency: string };

export type ScoreBudget = { categoryId: string; categoryName: string; periodMonth: string; limitCents: number };

export type ScoreYearlyBudget = { categoryId: string; categoryName: string; year: number; limitCents: number };

export type ScoreRecurringRule = {
  name: string;
  type: "EXPENSE" | "INCOME" | "TRANSFER";
  amountCents: number;
  cadence: "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY" | "BIENNIAL" | "SEMI_MONTHLY";
  enabled: boolean;
  endDate: Date | null;
  /** The bill's category, when known: a bill filed under "Mortgage" already counts the payment. */
  categoryName?: string;
};

/** A credit card with something owing on it. */
export type ScoreCard = {
  accountId: string;
  name: string;
  /** Latest balance owing, positive. */
  balanceCents: number;
  /**
   * Charged to the card in the `PAID_IN_FULL_WINDOW_DAYS` up to that balance. A balance no
   * larger than this is being paid off each statement (`paidInFull`).
   */
  recentChargesCents: number;
  creditLimitCents: number | null;
  interestRateBps: number | null;
  minimumPaymentCents: number | null;
  /** Month-end balances over the scored months with a reading, oldest first. */
  history: number[];
};

/** A loan or mortgage. */
export type ScoreLoan = {
  accountId: string;
  name: string;
  type: "LOAN" | "MORTGAGE";
  /** Latest balance owing; null without a reading. */
  balanceCents: number | null;
  interestRateBps: number | null;
  minimumPaymentCents: number | null;
  /** Money paid into it per `YYYY-MM`, by transfer or entries on the account itself. */
  paymentsByMonth: ReadonlyMap<string, number>;
  /** Recurring transfers into it, as a monthly amount. */
  recurringPaymentCents: number;
};

export type ScoreGoal = {
  name: string;
  status: "reached" | "overdue" | "on-track" | "behind" | "needs" | "open" | "no-balance";
  monthlyNeededCents: number | null;
};

export type FinancialScoreInput = {
  /** Expense and income rows; transfers are ignored if present. May reach back to 1 January for yearly budgets. */
  txs: readonly ReportTx[];
  budgets: readonly ScoreBudget[];
  recurring: readonly ScoreRecurringRule[];
  todayYmd: string;
  /** Formats cents for suggestion text. */
  formatCents: (cents: number) => string;
  /**
   * Net cents moved into savings accounts per `YYYY-MM`; null when no account counts as
   * savings, and the savings rate is then income less spending.
   */
  toSavingsByMonth?: ReadonlyMap<string, number> | null;
  /**
   * Budget rollover carried into a month, per `YYYY-MM|categoryId` (`loadRolloverCarries`). A
   * month's budget is kept when spend stays within its limit plus this carry.
   */
  rolloverCarries?: ReadonlyMap<string, number>;
  /** Yearly budgets; the one in force for the last scored month's year counts once. */
  yearlyBudgets?: readonly ScoreYearlyBudget[];
  /**
   * Latest total balance of the emergency-fund accounts (`emergencyFundCents`); null when none
   * of them has a balance yet, and the factor is then left out.
   */
  emergencyFundCents?: number | null;
  /**
   * The lowest combined balance of the everyday accounts (chequing and cash) per `YYYY-MM`,
   * worked back from their readings; null when none has a reading.
   */
  everydayLowsByMonth?: ReadonlyMap<string, number> | null;
  /** Credit cards with a balance owing, in the score's currency. */
  cards?: readonly ScoreCard[];
  loans?: readonly ScoreLoan[];
  /**
   * Net worth at the start and end of the scored months, from accounts read in both halves
   * (property values typed in by hand left out); null with too few readings.
   */
  netWorth?: { startYm: string; startCents: number; endCents: number; biggestDrop: { name: string; cents: number } | null } | null;
  /**
   * The first everyday account the recurring bills and plans take below zero in the next 60
   * days (`projectBalances`); `belowZero` null when none. Null without a recent balance.
   */
  outlook?: { belowZero: { accountName: string; days: number; dateLabel: string; cause: string | null } | null } | null;
  /** Savings goals with a target date. */
  goals?: readonly ScoreGoal[];
  /**
   * Long-term saving: how many TFSA, RRSP, FHSA and non-registered accounts there are, what went
   * into them over the scored months, what they hold, and the user's age if known.
   */
  longTerm?: { accountCount: number; contributedCents: number; investedCents: number | null; age: number | null } | null;
  /** Need or want per expense category id, for the 50/30/20 split. */
  categoryRoles?: ReadonlyMap<string, "NEED" | "WANT">;
  /** Accounts in another currency with entries in the scored months or a balance; see `otherCurrencyAccounts`. */
  otherCurrencyAccounts?: readonly OtherCurrencyAccount[];
};

/** Never part of the emergency fund: retirement savings, things owned, and what is owed. */
const NOT_EMERGENCY_FUND: ReadonlySet<string> = new Set<AccountType>([
  AccountType.RRSP,
  AccountType.PROPERTY,
  AccountType.CREDIT_CARD,
  AccountType.LOAN,
  AccountType.MORTGAGE,
]);
/** Always part of it: money that is already spendable. */
const EMERGENCY_FUND_TYPES: ReadonlySet<string> = new Set<AccountType>([AccountType.CHEQUING, AccountType.SAVINGS, AccountType.CASH]);

/** Where everyday spending is paid from: the cash buffer is measured on these. */
export const EVERYDAY_ACCOUNT_TYPES: ReadonlySet<string> = new Set<AccountType>([AccountType.CHEQUING, AccountType.CASH]);

/** Accounts that hold long-term savings. */
export const LONG_TERM_ACCOUNT_TYPES: ReadonlySet<string> = new Set<AccountType>([
  AccountType.TFSA,
  AccountType.RRSP,
  AccountType.FHSA,
  AccountType.NON_REGISTERED,
]);

/**
 * Whether an account's balance counts toward the emergency fund: chequing, savings and cash,
 * plus any other account marked "Counts as savings" (a TFSA kept as a cushion, say) except
 * an RRSP, which cannot be drawn on without tax.
 */
export function isEmergencyFundAccount(account: { type: AccountType | string; countsAsSavings: boolean }): boolean {
  if (NOT_EMERGENCY_FUND.has(account.type)) return false;
  return EMERGENCY_FUND_TYPES.has(account.type) || account.countsAsSavings;
}

/**
 * The emergency fund's total from each account's latest balance, or null when no
 * emergency-fund account has one. Archived accounts and those in another currency than the
 * score's are left out, as net worth leaves them out.
 */
export function emergencyFundCents(
  accounts: ReadonlyArray<{ type: AccountType | string; countsAsSavings: boolean; archived: boolean; currency: string; latestCents: number | null }>,
  currency: string,
): number | null {
  let total: number | null = null;
  for (const a of accounts) {
    if (a.archived || a.latestCents === null || a.currency.toUpperCase() !== currency.toUpperCase()) continue;
    if (!isEmergencyFundAccount(a)) continue;
    total = (total ?? 0) + a.latestCents;
  }
  return total;
}

/**
 * How far back a card's charges can explain its balance. A card cleared every statement owes at
 * most the cycle that just closed (and is due in a few weeks) plus the one running now: under two
 * months of charges.
 */
export const PAID_IN_FULL_WINDOW_DAYS = 60;

/**
 * Whether a card looks paid in full each month: everything it owes was charged in the last
 * {@link PAID_IN_FULL_WINDOW_DAYS} days, so no older balance is being carried and no interest is
 * running. A balance larger than its recent charges is carried debt. With no charges recorded on
 * the card there is nothing to tell by, and the balance is taken as debt.
 */
export function paidInFull(card: { balanceCents: number; recentChargesCents: number }): boolean {
  return card.recentChargesCents > 0 && card.balanceCents <= card.recentChargesCents;
}

/** What a card carries beyond its recent charges; 0 when it is paid off each statement. */
export function carriedCents(card: { balanceCents: number; recentChargesCents: number }): number {
  if (card.balanceCents <= 0 || paidInFull(card)) return 0;
  const carried = card.balanceCents - Math.max(0, card.recentChargesCents);
  return carried >= MIN_CARRIED_CENTS ? carried : 0;
}

/**
 * A guess at whether a category is a need or a want from its name and group, for categories
 * the user has not marked. Housing, food at home, utilities, transport, health, insurance,
 * childcare and debt payments are needs; anything else is a want.
 */
const NEED_TEXT =
  /rent|mortgage|hypoth|housing|home|property tax|utilit|hydro|electric|water|heat|gas\b|internet|phone|mobile|grocer|[ée]picerie|supermarket|transport|transit|fuel|car\b|auto|insurance|assurance|health|medical|pharma|dental|child ?care|daycare|tuition|loan|debt|bills?\b|fixed|essential|necessit|家賃|光熱費|食費|医療|保険|交通費/i;

export function guessSpendingRole(category: { name: string; groupName?: string | null }): "NEED" | "WANT" {
  return NEED_TEXT.test(category.name) || (category.groupName ? NEED_TEXT.test(category.groupName) : false) ? "NEED" : "WANT";
}

const BASE_WEIGHTS: Record<FinancialScoreFactorId, number> = {
  savings: 25,
  emergency: 15,
  bills: 15,
  budgets: 10,
  trend: 10,
  buffer: 10,
  consistency: 10,
  cards: 10,
  loans: 10,
  fees: 5,
  networth: 5,
  outlook: 5,
  goals: 5,
  longterm: 10,
};

/** Straight-line interpolation through `points` (x ascending), clamped at both ends, to 0–100. */
function piecewise(x: number, points: ReadonlyArray<readonly [number, number]>): number {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (x <= x1) {
      const [x0, y0] = points[i - 1];
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return points[points.length - 1][1];
}

const pct = (ratio: number) => `${Math.round(ratio * 100)}%`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const rateText = (bps: number) => `${(bps / 100).toFixed(2).replace(/\.?0+$/, "")}%`;
const listWords = (words: readonly string[]) =>
  words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = (ym: string) => MONTH_NAMES[Number(ym.slice(5, 7)) - 1];

export function scoreBand(score: number): FinancialScoreBand {
  if (score >= 80) return "Strong";
  if (score >= 65) return "Good";
  if (score >= 50) return "Fair";
  if (score >= 35) return "Needs work";
  return "At risk";
}

/** Recurring bills as a monthly amount; disabled and ended rules do not count. */
export function monthlyRecurringCents(rules: readonly ScoreRecurringRule[], type: "EXPENSE" | "INCOME", todayYmd: string) {
  return rules
    .filter((r) => r.enabled && r.type === type && (!r.endDate || r.endDate.toISOString().slice(0, 10) >= todayYmd))
    .map((r) => ({ name: r.name, cents: Math.round(r.amountCents * MONTHLY_FACTOR[r.cadence]), categoryName: r.categoryName }))
    .sort((a, b) => b.cents - a.cents);
}

/** The factors worth acting on, weakest first: at most three, each with a suggestion. */
export function weakestFactors(factors: readonly FinancialScoreFactor[]): FinancialScoreFactor[] {
  return [...factors]
    .filter((f) => f.suggestion && f.score < 80)
    .sort((a, b) => a.score - b.score || b.weight - a.weight)
    .slice(0, 3);
}

/** Fees that mean a payment was missed or bounced, rather than an account's running costs. */
const MISSED_PAYMENT_FEE_TEXT = /\bnsf\b|non-?sufficient|overdraft|\blate (?:payment )?fee\b|returned (?:payment|item)/i;
const INTEREST_TEXT = /interest/i;

type Factor = Omit<FinancialScoreFactor, "weight" | "pillar">;

export function computeFinancialScore(input: FinancialScoreInput): FinancialScore {
  const { formatCents: fmt } = input;
  const currentYm = input.todayYmd.slice(0, 7);
  const txs = input.txs.filter((tx) => tx.type === "EXPENSE" || tx.type === "INCOME");

  const firstYm = txs.reduce<string | null>((min, tx) => {
    const ym = ymOf(tx.date);
    return min === null || ym < min ? ym : min;
  }, null);
  const months: string[] = [];
  for (let i = SCORE_LOOKBACK_MONTHS; i >= 1; i--) {
    const ym = shiftYm(currentYm, -i);
    if (firstYm !== null && ym >= firstYm) months.push(ym);
  }
  const lastYm = months[months.length - 1];

  const byMonth = new Map(months.map((ym) => [ym, { income: 0, spending: 0 }]));
  const spendByMonthCategory = new Map<string, number>();
  const spendByCategoryName = new Map<string, { recent: number; earlier: number }>();
  const recentMonths = new Set(months.slice(-TREND_HALF));
  /** Spend per category from 1 January through the last scored month, for yearly budgets. */
  const yearToDateByCategory = new Map<string, number>();
  const fees: ReportTx[] = [];
  let needsCents = 0;
  for (const tx of txs) {
    const ym = ymOf(tx.date);
    if (tx.type === "EXPENSE" && lastYm && ym.slice(0, 4) === lastYm.slice(0, 4) && ym <= lastYm) {
      for (const part of categoryAmounts(tx)) {
        yearToDateByCategory.set(part.categoryId, (yearToDateByCategory.get(part.categoryId) ?? 0) + part.amountCents);
      }
    }
    const bucket = byMonth.get(ym);
    if (!bucket) continue;
    if (tx.type === "INCOME") {
      bucket.income += tx.amountCents;
      continue;
    }
    bucket.spending += tx.amountCents;
    if (tx.amountCents > 0 && isBankFee(tx)) fees.push(tx);
    for (const part of categoryAmounts(tx)) {
      const key = `${ym}|${part.categoryId}`;
      spendByMonthCategory.set(key, (spendByMonthCategory.get(key) ?? 0) + part.amountCents);
      const byName = spendByCategoryName.get(part.categoryName) ?? { recent: 0, earlier: 0 };
      if (recentMonths.has(ym)) byName.recent += part.amountCents;
      else byName.earlier += part.amountCents;
      spendByCategoryName.set(part.categoryName, byName);
      if (input.categoryRoles?.get(part.categoryId) === "NEED") needsCents += part.amountCents;
    }
  }

  const flows = months.map((ym) => ({ ym, ...byMonth.get(ym)! }));
  const totalIncome = flows.reduce((s, m) => s + m.income, 0);
  const totalSpending = flows.reduce((s, m) => s + m.spending, 0);
  if (months.length === 0) {
    return { status: "insufficient", reason: "The score needs at least one full month of income and spending. Check back next month." };
  }
  if (totalIncome <= 0) {
    return {
      status: "insufficient",
      reason: "No income is recorded in the last few full months, so there is nothing to measure spending against.",
    };
  }
  const avgIncome = totalIncome / months.length;
  const avgSpending = totalSpending / months.length;
  const recent = months.slice(-RECENT_MONTHS);

  const factors: Factor[] = [];
  const left: FinancialScoreOmission[] = [];

  // --- Spend ---------------------------------------------------------------------------------

  // Savings rate: what share of income was moved into savings accounts or, with none marked,
  // left after spending.
  const toSavings = input.toSavingsByMonth ?? null;
  const savedCents = toSavings
    ? months.reduce((s, ym) => s + (toSavings.get(ym) ?? 0), 0)
    : totalIncome - totalSpending;
  const savingsRate = savedCents / totalIncome;
  const savingsScore = piecewise(savingsRate, [
    [-0.1, 0],
    [0, 35],
    [0.1, 65],
    [0.2, 90],
    [0.3, 100],
  ]);
  const toTwenty = Math.ceil(Math.max(0, 0.2 * avgIncome - savedCents / months.length));
  factors.push({
    id: "savings",
    label: "Savings rate",
    score: savingsScore,
    detail: toSavings
      ? savingsRate >= 0
        ? `${pct(savingsRate)} of income moved to savings`
        : `${pct(-savingsRate)} of income taken out of savings`
      : savingsRate >= 0
        ? `${pct(savingsRate)} of income saved`
        : `Spent ${pct(-savingsRate)} more than earned`,
    suggestion:
      savingsRate < 0.2
        ? toSavings
          ? `Moving about ${fmt(toTwenty)} more a month into savings would bring your savings rate to 20%.`
          : `Spending about ${fmt(toTwenty)} less a month would bring your savings rate to 20%.`
        : null,
  });

  // Committed income: recurring bills on a monthly footing, plus the debt payments that count,
  // as a share of average income.
  const cards = (input.cards ?? []).filter((c) => c.balanceCents > 0);
  const carried = cards.map((c) => ({ card: c, cents: carriedCents(c) })).filter((c) => c.cents > 0);
  const loanChecks = (input.loans ?? []).map((loan) => ({ loan, ...loanPaymentCheck(loan, recent) }));
  const missedLoans = loanChecks.filter((l) => l.checks > 0 && l.credit < l.checks);

  const bills = monthlyRecurringCents(input.recurring, "EXPENSE", input.todayYmd);
  const mortgageBillSetUp = bills.some((b) => /mortgage|hypoth/i.test(`${b.name} ${b.categoryName ?? ""}`));
  const debtPayments: Array<{ name: string; cents: number }> = [];
  for (const { loan } of loanChecks) {
    if ((loan.balanceCents ?? 1) <= 0) continue;
    const monthly = loan.recurringPaymentCents > 0 ? loan.recurringPaymentCents : (loan.minimumPaymentCents ?? 0);
    if (monthly <= 0) continue;
    // A mortgage is housing and counts like rent; another loan only once its payments slip.
    if (loan.type === "MORTGAGE" ? !mortgageBillSetUp : missedLoans.some((m) => m.loan === loan)) {
      debtPayments.push({ name: loan.name, cents: monthly });
    }
  }
  for (const { card } of carried) {
    if (card.minimumPaymentCents) debtPayments.push({ name: card.name, cents: card.minimumPaymentCents });
  }
  const committed = [...bills, ...debtPayments].sort((a, b) => b.cents - a.cents);
  const committedCents = committed.reduce((s, b) => s + b.cents, 0);
  const committedShare = committedCents / avgIncome;
  const topCommitted = committed.slice(0, 3).map((b) => `${b.name} (${fmt(b.cents)}/mo)`);
  if (committed.length === 0) left.push({ label: "Fixed bills", reason: "no recurring bills set up" });
  else
    factors.push({
      id: "bills",
      label: debtPayments.length ? "Bills and debt payments" : "Fixed bills",
      score: piecewise(committedShare, [
        [0.35, 100],
        [0.5, 70],
        [0.65, 35],
        [0.8, 0],
      ]),
      detail: debtPayments.length
        ? `${pct(committedShare)} of income goes to recurring bills and debt payments`
        : `${pct(committedShare)} of income goes to recurring bills`,
      suggestion:
        committedShare > 0.35
          ? `${debtPayments.length ? "Bills and debt payments take" : "Recurring bills take"} ${pct(committedShare)} of income. ${topCommitted.length === 1 ? "The largest is" : "The largest are"} ${topCommitted.join(", ")}; trimming or renegotiating one frees room every month.`
          : null,
    });

  // Budget adherence: each budgeted category in each recent month, within its limit or not,
  // and each yearly budget once for the year so far.
  let checks = 0;
  let credit = 0;
  const overByCategory = new Map<string, number>();
  for (const ym of recent) {
    for (const budget of selectActiveBudgetsByCategory(input.budgets, ym).values()) {
      if (budget.limitCents <= 0) continue;
      const spent = spendByMonthCategory.get(`${ym}|${budget.categoryId}`) ?? 0;
      const limit = budget.limitCents + (input.rolloverCarries?.get(`${ym}|${budget.categoryId}`) ?? 0);
      checks++;
      if (spent <= limit) credit += 1;
      else {
        if (limit > 0 && spent <= limit * 1.1) credit += 0.5;
        overByCategory.set(budget.categoryName, (overByCategory.get(budget.categoryName) ?? 0) + 1);
      }
    }
  }
  const year = Number(lastYm.slice(0, 4));
  const yearly = [...activeYearlyBudgets(input.yearlyBudgets ?? [], year).values()].filter((b) => b.limitCents > 0);
  const yearlyOver: string[] = [];
  for (const budget of yearly) {
    const spent = yearToDateByCategory.get(budget.categoryId) ?? 0;
    checks++;
    if (spent <= budget.limitCents) credit += 1;
    else {
      if (spent <= budget.limitCents * 1.1) credit += 0.5;
      yearlyOver.push(budget.categoryName);
    }
  }
  if (checks === 0) left.push({ label: "Budgets kept", reason: "no budgets set" });
  else {
    const worst = [...overByCategory.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    const within = checks - [...overByCategory.values()].reduce((s, n) => s + n, 0) - yearlyOver.length;
    const monthly = checks - yearly.length;
    factors.push({
      id: "budgets",
      label: "Budgets kept",
      score: (credit / checks) * 100,
      detail: yearly.length
        ? `${within} of ${checks} budgets kept: monthly over the last ${plural(recent.length, "month")}, yearly so far this year`
        : `${within} of ${checks} monthly budget${monthly === 1 ? "" : "s"} kept in the last ${plural(recent.length, "month")}`,
      suggestion: worst
        ? `${worst[0]} went over budget in ${worst[1]} of the last ${plural(recent.length, "month")}. Raise the limit to something you can keep, or move room from a category with spare.`
        : yearlyOver.length
          ? `${listWords(yearlyOver)} ${yearlyOver.length === 1 ? "is" : "are"} already over ${yearlyOver.length === 1 ? "its" : "their"} yearly budget for ${year}. Raise the yearly limit, or hold back on ${yearlyOver.length === 1 ? "it" : "them"} until January.`
          : null,
    });
  }

  // Spending trend: the latest three months against the three before.
  const recentSpending = flows.slice(-TREND_HALF).reduce((s, m) => s + m.spending, 0);
  const earlierSpending = flows.slice(-TREND_HALF * 2, -TREND_HALF).reduce((s, m) => s + m.spending, 0);
  if (months.length < TREND_HALF * 2 || earlierSpending <= 0) {
    left.push({ label: "Spending trend", reason: `needs ${TREND_HALF * 2} full months of history` });
  } else {
    const change = (recentSpending - earlierSpending) / earlierSpending;
    const riser = [...spendByCategoryName.entries()]
      .map(([name, v]) => ({ name, delta: v.recent - v.earlier }))
      .sort((a, b) => b.delta - a.delta || a.name.localeCompare(b.name))[0];
    factors.push({
      id: "trend",
      label: "Spending trend",
      score: piecewise(change, [
        [-0.05, 100],
        [0, 80],
        [0.1, 50],
        [0.25, 0],
      ]),
      detail:
        Math.abs(change) < 0.005
          ? "Spending is flat on the 3 months before"
          : `Spending ${change > 0 ? "up" : "down"} ${pct(Math.abs(change))} on the 3 months before`,
      suggestion:
        change > 0 && riser && riser.delta > 0
          ? `Spending over the last 3 months was ${pct(change)} above the 3 before. The biggest rise is ${riser.name}, up ${fmt(Math.round(riser.delta / TREND_HALF))} a month.`
          : null,
    });
  }

  // Cash buffer: how low the everyday accounts got each recent month, in days of spending. It
  // says the same as "months in the black" and more (how close to the edge pay day comes), so
  // it takes that factor's place when there are balances to measure it by.
  const positive = flows.filter((m) => m.income - m.spending >= 0).length;
  const short = months.length - positive;
  const lows = recent.flatMap((ym) => {
    const low = input.everydayLowsByMonth?.get(ym);
    return low === undefined ? [] : [low];
  });
  const dailySpending = avgSpending / (365.25 / 12);
  if (lows.length && dailySpending > 0) {
    const avgLow = lows.reduce((s, n) => s + n, 0) / lows.length;
    const lowest = Math.min(...lows);
    const days = avgLow / dailySpending;
    const toMonth = Math.ceil(30 * dailySpending - avgLow);
    factors.push({
      id: "buffer",
      label: "Cash buffer",
      score: avgLow < 0 ? 0 : piecewise(days, [
        [0, 5],
        [7, 30],
        [14, 55],
        [30, 85],
        [60, 100],
      ]),
      detail:
        avgLow < 0
          ? "Everyday accounts dipped below zero"
          : `Everyday accounts got down to about ${plural(Math.round(days), "day")} of spending`,
      suggestion:
        days < 30
          ? `Chequing got as low as ${fmt(lowest)} in the last ${plural(lows.length, "month")}${days >= 0 ? `, about ${plural(Math.max(0, Math.round(lowest / dailySpending)), "day")} of spending` : ""}. Keeping about ${fmt(toMonth)} more there gives you a month's head start, so bills never wait on pay day.`
          : null,
    });
  } else {
    factors.push({
      id: "consistency",
      label: "Months in the black",
      score: (positive / months.length) * 100,
      detail: `${positive} of ${plural(months.length, "month")} ended with money left over`,
      suggestion:
        short > 0
          ? `You spent more than you earned in ${short} of the last ${plural(months.length, "month")}. Setting money aside on payday for the irregular months evens this out.`
          : null,
    });
  }

  // --- Save ----------------------------------------------------------------------------------

  // Emergency fund: what chequing and savings hold, in months of average spending. Income that
  // swings from month to month needs a deeper cushion.
  const unsteady = months.length >= 3 && variation(flows.map((m) => m.income)) > UNSTEADY_INCOME_VARIATION;
  const target = unsteady ? UNSTEADY_INCOME_TARGET_MONTHS : EMERGENCY_FUND_TARGET_MONTHS;
  const fund = input.emergencyFundCents ?? null;
  if (fund === null) left.push({ label: "Emergency fund", reason: "no chequing or savings balances yet" });
  else {
    const covered = avgSpending > 0 ? fund / avgSpending : fund > 0 ? Infinity : 0;
    const shortfall = Math.ceil(target * avgSpending - fund);
    const monthsText = (n: number) => `${n.toFixed(1)} month${n.toFixed(1) === "1.0" ? "" : "s"}`;
    const k = target / EMERGENCY_FUND_TARGET_MONTHS;
    factors.push({
      id: "emergency",
      label: "Emergency fund",
      score: piecewise(covered, [
        [0, 0],
        [1 * k, 40],
        [2 * k, 70],
        [target, 90],
        [6 * k, 100],
      ]),
      detail:
        fund < 0
          ? "Chequing and savings are overdrawn"
          : avgSpending > 0
            ? `${monthsText(covered)} of spending in chequing and savings`
            : "No spending to measure it against",
      suggestion:
        shortfall > 0
          ? `${fund > 0 ? `Chequing and savings cover ${monthsText(covered)} of spending.` : "Chequing and savings hold nothing to fall back on."} Setting aside about ${fmt(shortfall)} would build a ${target}-month emergency fund${unsteady ? ", the aim when income changes this much from month to month" : ""}.`
          : null,
    });
  }

  // Long-term saving: what goes into TFSA, RRSP, FHSA and investment accounts, and, with an age,
  // what they hold against a rule-of-thumb multiple of a year's income for that age.
  const longTerm = input.longTerm ?? null;
  if (!longTerm || longTerm.accountCount === 0) {
    left.push({ label: "Long-term savings", reason: "no TFSA, RRSP, FHSA or investment accounts" });
  } else {
    const rate = longTerm.contributedCents / totalIncome;
    const contributionScore = piecewise(rate, [
      [0, 10],
      [0.05, 50],
      [0.1, 80],
      [0.15, 100],
    ]);
    const benchmark = longTerm.age !== null && longTerm.age >= 25 ? savingsMultipleFor(longTerm.age) : null;
    const multiple = benchmark !== null && longTerm.investedCents !== null ? longTerm.investedCents / (avgIncome * 12) : null;
    const multipleScore =
      multiple !== null && benchmark !== null
        ? piecewise(multiple / benchmark, [
            [0, 0],
            [0.5, 50],
            [1, 90],
            [1.5, 100],
          ])
        : null;
    const toTen = Math.ceil(Math.max(0, 0.1 * avgIncome - longTerm.contributedCents / months.length));
    const behindAge = multiple !== null && benchmark !== null && multiple < benchmark;
    factors.push({
      id: "longterm",
      label: "Long-term savings",
      score: multipleScore === null ? contributionScore : (contributionScore + multipleScore) / 2,
      detail:
        `${pct(Math.max(0, rate))} of income into long-term accounts` +
        (multiple !== null && benchmark !== null
          ? `; they hold ${multiple.toFixed(1)}× a year's income (about ${benchmark.toFixed(1)}× is typical at ${longTerm.age})`
          : ""),
      suggestion:
        rate < 0.1
          ? `Putting about ${fmt(toTen)} more a month into a TFSA or RRSP would bring long-term saving to 10% of income${behindAge ? `, and help close the gap to about ${benchmark!.toFixed(1)}× a year's income, a common benchmark at ${longTerm.age}` : ""}.`
          : behindAge
            ? `Your long-term accounts hold ${multiple!.toFixed(1)}× a year's income; about ${benchmark!.toFixed(1)}× is a common benchmark at ${longTerm.age}. The Retirement page shows when today's pace gets you there.`
            : null,
    });
  }

  // --- Borrow (only when debt is a problem) --------------------------------------------------

  // Credit cards: balances carried from month to month, and how much of the limit they use.
  if (carried.length === 0) {
    if (cards.length) left.push({ label: "Credit cards", reason: "paid off each month" });
  } else {
    const carriedTotal = carried.reduce((s, c) => s + c.cents, 0);
    const limited = carried.filter((c) => c.card.creditLimitCents && c.card.creditLimitCents > 0);
    const utilization = limited.length
      ? limited.reduce((s, c) => s + c.card.balanceCents, 0) / limited.reduce((s, c) => s + c.card.creditLimitCents!, 0)
      : null;
    const carriedScore = piecewise(carriedTotal / avgIncome, [
      [0, 100],
      [0.25, 70],
      [0.5, 50],
      [1, 25],
      [2, 0],
    ]);
    const utilizationScore =
      utilization === null
        ? null
        : piecewise(utilization, [
            [0.1, 100],
            [HIGH_UTILIZATION, 70],
            [0.5, 40],
            [0.9, 0],
          ]);
    const growing = carried.some(({ card }) => isGrowing(card.history));
    const biggest = [...carried].sort((a, b) => b.cents - a.cents)[0];
    const monthlyInterest = biggest.card.interestRateBps ? (biggest.card.balanceCents * biggest.card.interestRateBps) / 10_000 / 12 : 0;
    const toClear = Math.ceil(biggest.cents / 12 + monthlyInterest);
    factors.push({
      id: "cards",
      label: "Credit cards",
      score: Math.max(0, (utilizationScore === null ? carriedScore : (carriedScore + utilizationScore) / 2) - (growing ? 15 : 0)),
      detail:
        `${fmt(carriedTotal)} carried on ${carried.length === 1 ? carried[0].card.name : plural(carried.length, "card")}` +
        (utilization !== null ? `, ${pct(utilization)} of ${limited.length === 1 ? "its limit" : "their limits"}` : "") +
        (growing ? ", and growing" : ""),
      suggestion:
        `${biggest.card.name} carries about ${fmt(biggest.cents)} from month to month` +
        (biggest.card.interestRateBps ? ` at ${rateText(biggest.card.interestRateBps)}` : "") +
        (growing ? ", and the balance has been growing" : "") +
        `. Paying about ${fmt(toClear)} a month on top of new charges clears it in a year` +
        (utilization !== null && utilization > HIGH_UTILIZATION ? ` and brings use of the limit under ${pct(HIGH_UTILIZATION)}` : "") +
        ". Debt payoff on Reports compares the order to pay cards and loans in.",
    });
  }

  // Loan and mortgage payments: months that got less than the minimum.
  if (missedLoans.length) {
    const checked = loanChecks.filter((l) => l.checks > 0);
    const total = checked.reduce((s, l) => s + l.checks, 0);
    const got = checked.reduce((s, l) => s + l.credit, 0);
    const worst = [...missedLoans].sort((a, b) => a.credit / a.checks - b.credit / b.checks)[0];
    const missedMonths = worst.checks - Math.floor(worst.credit);
    factors.push({
      id: "loans",
      label: "Loan payments",
      score: (got / total) * 100,
      detail: `${worst.loan.name} got less than its minimum in ${missedMonths} of the last ${plural(worst.checks, "month")}`,
      suggestion: `${worst.loan.name}'s minimum is ${fmt(worst.loan.minimumPaymentCents!)} a month, but ${fmt(worst.shortMonth.paidCents)} went to it in ${monthName(worst.shortMonth.ym)}. A missed payment adds fees and is reported against your credit; a recurring transfer for the minimum on pay day keeps it on time.`,
    });
  } else if (loanChecks.some((l) => l.checks > 0)) {
    left.push({ label: "Loan payments", reason: "minimums paid" });
  }

  // Interest and fees: fees the log shows, plus interest estimated on the debt that counts.
  const feeTotal = fees.reduce((s, tx) => s + tx.amountCents, 0);
  const missedFee = fees.find((tx) => MISSED_PAYMENT_FEE_TEXT.test(`${tx.title ?? ""} ${tx.merchantName ?? ""} ${tx.note ?? ""}`));
  const interestLogged = new Set(
    fees.filter((tx) => tx.accountId && INTEREST_TEXT.test(`${tx.title ?? ""} ${tx.merchantName ?? ""}`)).map((tx) => tx.accountId),
  );
  const estimated = [
    ...carried.map(({ card }) => ({ name: card.name, accountId: card.accountId, balance: card.balanceCents, bps: card.interestRateBps })),
    ...missedLoans.map(({ loan }) => ({ name: loan.name, accountId: loan.accountId, balance: loan.balanceCents ?? 0, bps: loan.interestRateBps })),
  ]
    .filter((d) => d.bps && d.balance > 0 && !interestLogged.has(d.accountId))
    .map((d) => ({ name: d.name, bps: d.bps!, cents: Math.round((d.balance * d.bps!) / 10_000 / 12) }));
  const monthlyCost = feeTotal / months.length + estimated.reduce((s, d) => s + d.cents, 0);
  if (monthlyCost <= 0) left.push({ label: "Interest and fees", reason: "none paid" });
  else {
    const share = monthlyCost / avgIncome;
    const topInterest = [...estimated].sort((a, b) => b.cents - a.cents)[0];
    const topFee = [...fees].sort((a, b) => b.amountCents - a.amountCents)[0];
    const feeName = (tx: ReportTx) => tx.title?.trim() || tx.merchantName?.trim() || "A bank fee";
    factors.push({
      id: "fees",
      label: "Interest and fees",
      score: Math.min(missedFee ? 60 : 100, piecewise(share, [
        [0, 100],
        [0.005, 70],
        [0.02, 0],
      ])),
      detail: `About ${fmt(Math.round(monthlyCost))} a month in ${estimated.length ? "interest and fees" : "fees"}, ${(share * 100).toFixed(1)}% of income`,
      suggestion: missedFee
        ? `${feeName(missedFee)} (${fmt(missedFee.amountCents)} in ${monthName(ymOf(missedFee.date))}) is charged when a payment bounces or comes in late. A small buffer in chequing, or a reminder before each due date, avoids it.`
        : topInterest && topInterest.cents * months.length >= (topFee?.amountCents ?? 0)
          ? `${topInterest.name}'s ${rateText(topInterest.bps)} costs about ${fmt(topInterest.cents)} a month on its balance. Paying it down first, or moving it to a lower rate, saves that every month.`
          : topFee
            ? `${feeName(topFee)} cost ${fmt(topFee.amountCents)} in ${monthName(ymOf(topFee.date))}. A no-fee account or card, or asking the bank to waive it, saves it.`
            : null,
    });
  }

  // --- Plan ----------------------------------------------------------------------------------

  // Net worth direction over the scored months, against a year's income.
  const worth = input.netWorth ?? null;
  if (!worth) left.push({ label: "Net worth direction", reason: "needs balances read 3 months apart" });
  else {
    const change = worth.endCents - worth.startCents;
    const ratio = change / (avgIncome * 12);
    factors.push({
      id: "networth",
      label: "Net worth direction",
      score: piecewise(ratio, [
        [-0.15, 0],
        [-0.05, 30],
        [0, 60],
        [0.05, 100],
      ]),
      detail: change === 0 ? `Net worth flat since ${monthName(worth.startYm)}` : `Net worth ${change > 0 ? "up" : "down"} ${fmt(Math.abs(change))} since ${monthName(worth.startYm)}`,
      suggestion:
        change < 0
          ? `Net worth fell ${fmt(-change)} since ${monthName(worth.startYm)}${worth.biggestDrop ? `, most of it in ${worth.biggestDrop.name} (down ${fmt(worth.biggestDrop.cents)})` : ""}. Saving a set amount each pay day turns it back up.`
          : null,
    });
  }

  // Cash outlook: whether the recurring bills and plans take an everyday account below zero soon.
  const outlook = input.outlook ?? null;
  if (!outlook) left.push({ label: "Cash outlook", reason: "no balance read in the last month" });
  else {
    const dip = outlook.belowZero;
    factors.push({
      id: "outlook",
      label: "Cash outlook",
      score: dip ? piecewise(dip.days, [
        [0, 10],
        [14, 25],
        [60, 60],
      ]) : 100,
      detail: dip ? `${dip.accountName} goes below zero in ${plural(dip.days, "day")}` : "No account goes below zero in the next 60 days",
      suggestion: dip
        ? `${dip.accountName} is on course to go below zero on ${dip.dateLabel}${dip.cause ? `, when ${dip.cause} comes out` : ""}. Move money in before then, or move the bill's date; What if… on Reports tries changes.`
        : null,
    });
  }

  // Savings goals with a date: on pace or not.
  const goals = (input.goals ?? []).filter((g) => g.status === "on-track" || g.status === "behind" || g.status === "overdue");
  if (goals.length === 0) left.push({ label: "Savings goals", reason: "no dated goals with a pace yet" });
  else {
    const onTrack = goals.filter((g) => g.status === "on-track").length;
    const behind = goals.filter((g) => g.status !== "on-track").sort((a, b) => (b.monthlyNeededCents ?? 0) - (a.monthlyNeededCents ?? 0))[0];
    factors.push({
      id: "goals",
      label: "Savings goals",
      score: (onTrack / goals.length) * 100,
      detail: `${onTrack} of ${plural(goals.length, "dated goal")} on pace`,
      suggestion: behind
        ? behind.status === "overdue"
          ? `${behind.name} is past its date. Give it a new date you can make, so its monthly amount means something again.`
          : `${behind.name} is behind${behind.monthlyNeededCents ? `: it needs about ${fmt(behind.monthlyNeededCents)} a month to make its date` : ""}. A recurring transfer on pay day keeps it on pace.`
        : null,
    });
  }

  // --- Totals --------------------------------------------------------------------------------

  const totalWeight = factors.reduce((s, f) => s + BASE_WEIGHTS[f.id], 0);
  const weighted: FinancialScoreFactor[] = factors.map((f) => ({
    ...f,
    pillar: FACTOR_PILLAR[f.id],
    score: Math.round(f.score),
    weight: BASE_WEIGHTS[f.id] / totalWeight,
  }));
  const score = Math.round(factors.reduce((s, f) => s + f.score * BASE_WEIGHTS[f.id], 0) / totalWeight);
  const suggestions = weakestFactors(weighted).map((f) => f.suggestion as string);
  const pillars = (Object.keys(PILLAR_LABELS) as FinancialScorePillarId[]).map((id): FinancialScorePillar => {
    const own = factors.filter((f) => FACTOR_PILLAR[f.id] === id);
    const w = own.reduce((s, f) => s + BASE_WEIGHTS[f.id], 0);
    return {
      id,
      label: PILLAR_LABELS[id],
      score: w ? Math.round(own.reduce((s, f) => s + f.score * BASE_WEIGHTS[f.id], 0) / w) : null,
      weight: w / totalWeight,
      note: w
        ? null
        : id === "borrow"
          ? cards.length || loanChecks.some((l) => l.checks > 0)
            ? "No debt counted: cards are paid off and loan minimums are met"
            : "No debt counted"
          : "Nothing to measure yet",
    };
  });

  return {
    status: "scored",
    score,
    band: scoreBand(score),
    months,
    factors: weighted,
    pillars,
    suggestions,
    omitted: left,
    cushion: fund === null ? null : { fundCents: fund, monthlySpendingCents: Math.round(avgSpending) },
    emergencyTargetMonths: target,
    monthsInBlack: { positive, total: months.length },
    split: input.categoryRoles
      ? {
          needs: needsCents / totalIncome,
          wants: Math.max(0, totalSpending - needsCents) / totalIncome,
          saved: Math.max(0, savedCents) / totalIncome,
        }
      : null,
    otherCurrencyAccounts: [...(input.otherCurrencyAccounts ?? [])],
    change: null,
  };
}

/** The yearly budget in force for each category in `year`: the latest year on or before it. */
function activeYearlyBudgets(rows: readonly ScoreYearlyBudget[], year: number): Map<string, ScoreYearlyBudget> {
  const active = new Map<string, ScoreYearlyBudget>();
  for (const row of rows) {
    if (row.year > year) continue;
    const existing = active.get(row.categoryId);
    if (!existing || row.year > existing.year) active.set(row.categoryId, row);
  }
  return active;
}

/** Standard deviation over the mean; 0 for a mean of zero. */
export function variation(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((s, n) => s + n, 0) / values.length;
  if (mean <= 0) return 0;
  const sd = Math.sqrt(values.reduce((s, n) => s + (n - mean) ** 2, 0) / values.length);
  return sd / mean;
}

/** The last three readings each higher than the one before. */
function isGrowing(history: readonly number[]): boolean {
  if (history.length < 3) return false;
  const [a, b, c] = history.slice(-3);
  return b > a && c > b;
}

/**
 * Long-term savings as a multiple of a year's income, as commonly suggested for an age: about 1×
 * by 30, 3× by 40, 6× by 50, 8× by 60 and 10× by 67. A rule of thumb from retirement planners,
 * not an official figure.
 */
export function savingsMultipleFor(age: number): number {
  return piecewise(age, [
    [25, 0.25],
    [30, 1],
    [40, 3],
    [50, 6],
    [60, 8],
    [67, 10],
  ]);
}

/**
 * A loan's recent months against its minimum: full credit for a month that got at least 95% of
 * it, half for at least half. Months before the first payment seen are not judged (the loan
 * may not have been tracked yet), and a loan with no minimum or no payment seen at all is not
 * judged either: there is nothing to tell a missed payment from one paid some other way.
 */
export function loanPaymentCheck(
  loan: Pick<ScoreLoan, "balanceCents" | "minimumPaymentCents" | "paymentsByMonth">,
  months: readonly string[],
): { checks: number; credit: number; shortMonth: { ym: string; paidCents: number } } {
  const none = { checks: 0, credit: 0, shortMonth: { ym: months[0] ?? "", paidCents: 0 } };
  const minimum = loan.minimumPaymentCents ?? 0;
  if (minimum <= 0 || (loan.balanceCents !== null && loan.balanceCents <= 0)) return none;
  const paidMonths = [...loan.paymentsByMonth.entries()].filter(([, cents]) => cents > 0).map(([ym]) => ym).sort();
  if (paidMonths.length === 0) return none;
  const judged = months.filter((ym) => ym >= paidMonths[0]);
  let credit = 0;
  let shortMonth: { ym: string; paidCents: number } | null = null;
  for (const ym of judged) {
    const paid = loan.paymentsByMonth.get(ym) ?? 0;
    if (paid >= minimum * 0.95) credit += 1;
    else {
      if (paid >= minimum * 0.5) credit += 0.5;
      if (!shortMonth || paid < shortMonth.paidCents) shortMonth = { ym, paidCents: paid };
    }
  }
  return { checks: judged.length, credit, shortMonth: shortMonth ?? none.shortMonth };
}
