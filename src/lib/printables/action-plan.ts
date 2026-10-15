import { toCsv } from "@/lib/csv";
import { EMERGENCY_FUND_TARGET_MONTHS, type FinancialScore, type FinancialScoreFactorId } from "@/lib/financial-score";
import { fromCents } from "@/lib/money";
import type { ReportTx } from "@/lib/reports";
import type { GoalStatus } from "@/lib/savings-goals";

/**
 * The action plan: what to do next about the user's money, as a checklist over four horizons,
 * worked out from the same figures the summary prints. Every step says why, with the user's own
 * numbers, and steps already done are listed ticked so the plan shows progress too.
 *
 * A step's horizon is when it is worth having done, not when to start it: building six months
 * of emergency fund starts today but belongs to the 12-month list when that is how long it takes.
 */

/** Months ahead each list covers. 24 also takes everything further out. */
export const PLAN_HORIZONS = [3, 6, 12, 24] as const;
export type PlanHorizon = (typeof PLAN_HORIZONS)[number];

export const PLAN_HORIZON_LABELS: Record<PlanHorizon, string> = {
  3: "Next 3 months",
  6: "In 3 to 6 months",
  12: "In 6 to 12 months",
  24: "In 1 to 2 years and beyond",
};

/** What the page offers: everything up to a horizon, so "12" is the 3, 6 and 12-month lists. */
export const PLAN_RANGE_OPTIONS: ReadonlyArray<{ value: PlanHorizon; label: string }> = [
  { value: 3, label: "Next 3 months" },
  { value: 6, label: "Next 6 months" },
  { value: 12, label: "Next 12 months" },
  { value: 24, label: "Next 24 months and beyond" },
];

export function parsePlanRange(raw: string | null | undefined): PlanHorizon {
  const n = Number(raw);
  return (PLAN_HORIZONS as readonly number[]).includes(n) ? (n as PlanHorizon) : 24;
}

/** The horizon a step lands in when it takes `months` to finish. */
export function horizonFor(months: number): PlanHorizon {
  if (months <= 3) return 3;
  if (months <= 6) return 6;
  if (months <= 12) return 12;
  return 24;
}

export type PlanArea =
  | "Cash flow"
  | "Emergency fund"
  | "Debt"
  | "Bills"
  | "Budgets"
  | "Savings"
  | "Goals"
  | "Tax-free room"
  | "Retirement"
  | "Housekeeping";

export type PlanStep = {
  horizon: PlanHorizon;
  area: PlanArea;
  title: string;
  /** Why, with the user's figures. */
  detail: string;
  /** Higher comes first within a horizon; the top undone ones in the first horizon lead the plan. */
  priority: number;
  /** Already true: printed ticked. */
  done: boolean;
  /** An amount to reach or set aside, for the CSV and the right-hand column. */
  amountCents?: number | null;
  /** When the amount is a rate: so much "month" or "year". */
  per?: "month" | "year";
  /** A date to have it done by. */
  byYmd?: string | null;
};

export type PlanGoal = {
  name: string;
  currency: string;
  remainingCents: number;
  targetYmd: string | null;
  monthsLeft: number | null;
  monthlyNeededCents: number | null;
  status: GoalStatus;
};

export type PlanRoom = {
  accountType: "TFSA" | "RRSP" | "FHSA";
  year: number;
  remainingCents: number | null;
  /** Over the limit by enough to be taxed (for RRSP, above the cushion). */
  penaltyExcessCents: number;
};

export type PlanBill = { name: string; amountCents: number; dateYmd: string };

/** Everything the plan is worked out from, in the user's home currency. */
export type PlanFacts = {
  currency: string;
  todayYmd: string;
  countryCode: string;
  /** Full months the averages cover; 0 with no history. */
  monthsMeasured: number;
  avgIncomeCents: number;
  avgSpendingCents: number;
  /** Moved to savings a month, when accounts count as savings; otherwise income less spending. */
  avgSavedCents: number;
  monthsInRed: number;
  score: FinancialScore;
  /** Chequing, savings and cash; null when none has a balance yet. */
  emergencyFundCents: number | null;
  /**
   * Cards with a balance owing, each with what was charged to it in the
   * {@link PAID_IN_FULL_WINDOW_DAYS} days up to that balance (see {@link paidInFull}).
   */
  cards: Array<{ name: string; balanceCents: number; recentChargesCents: number }>;
  loans: Array<{ name: string; balanceCents: number }>;
  hasCardAccount: boolean;
  /** Spending categories by average a month, largest first, with their budget if any. */
  topCategories: Array<{ name: string; avgCents: number; budgeted: boolean }>;
  budgetCount: number;
  recurringBills: { count: number; monthlyCents: number };
  overdueBills: PlanBill[];
  next30Bills: PlanBill[];
  /** Quarterly, yearly and two-yearly bills due in the next 12 months. */
  irregularBills: Array<PlanBill & { monthsAway: number }>;
  hasSavingsTransferRule: boolean;
  goals: PlanGoal[];
  room: PlanRoom[];
  /** Accounts whose latest balance is old or missing. */
  staleBalances: string[];
  hasRetirementAccount: boolean;
  reviewQueueCount: number;
};

/**
 * Monthly averages over `months` (full months, oldest first), starting from the first month with
 * any income or spending, as the financial score measures them: a user who began two months ago
 * is averaged over two months, not six. Spending per category counts split parts in their own
 * category and refunds against theirs.
 */
export function monthlyAverages(
  txs: readonly ReportTx[],
  months: readonly string[],
  toSavingsByMonth: ReadonlyMap<string, number> | null,
): {
  months: string[];
  incomeCents: number;
  spendingCents: number;
  savedCents: number;
  monthsInRed: number;
  categories: Array<{ categoryId: string; name: string; avgCents: number }>;
} {
  const counted = txs.filter((tx) => tx.type === "INCOME" || tx.type === "EXPENSE");
  const first = counted.reduce<string | null>((min, tx) => {
    const ym = tx.date.toISOString().slice(0, 7);
    return min === null || ym < min ? ym : min;
  }, null);
  const used = first === null ? [] : months.filter((ym) => ym >= first);
  const byMonth = new Map(used.map((ym) => [ym, { income: 0, spending: 0 }]));
  const byCategory = new Map<string, { name: string; cents: number }>();
  for (const tx of counted) {
    const bucket = byMonth.get(tx.date.toISOString().slice(0, 7));
    if (!bucket) continue;
    if (tx.type === "INCOME") {
      bucket.income += tx.amountCents;
      continue;
    }
    bucket.spending += tx.amountCents;
    const parts = tx.splits.length ? tx.splits : [{ categoryId: tx.categoryId, categoryName: tx.categoryName, amountCents: tx.amountCents }];
    for (const part of parts) {
      const c = byCategory.get(part.categoryId) ?? { name: part.categoryName, cents: 0 };
      c.cents += part.amountCents;
      byCategory.set(part.categoryId, c);
    }
  }
  const n = Math.max(1, used.length);
  const flows = [...byMonth.values()];
  const income = flows.reduce((s, m) => s + m.income, 0);
  const spending = flows.reduce((s, m) => s + m.spending, 0);
  const saved = toSavingsByMonth ? used.reduce((s, ym) => s + (toSavingsByMonth.get(ym) ?? 0), 0) : income - spending;
  return {
    months: used,
    incomeCents: Math.round(income / n),
    spendingCents: Math.round(spending / n),
    savedCents: Math.round(saved / n),
    monthsInRed: flows.filter((m) => m.income - m.spending < 0).length,
    categories: [...byCategory.entries()]
      .map(([categoryId, c]) => ({ categoryId, name: c.name, avgCents: Math.round(c.cents / n) }))
      .filter((c) => c.avgCents > 0)
      .sort((a, b) => b.avgCents - a.avgCents || a.name.localeCompare(b.name)),
  };
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

/** Months of cover to one decimal, rounded down: 5.98 months is not yet "6.0". */
export function monthsText(months: number): string {
  return `${(Math.floor(months * 10) / 10).toFixed(1)} months`;
}

/** Balances older than this are worth updating before trusting the plan's figures. */
export const STALE_BALANCE_DAYS = 45;
/** A savings rate worth aiming for. */
const TARGET_SAVINGS_RATE = 0.2;
const FULL_FUND_MONTHS = 6;

function addMonthsYmd(ymd: string, months: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/** The last day of each horizon, for "by" dates in headings. */
export function horizonEndYmd(todayYmd: string, horizon: PlanHorizon): string {
  return addMonthsYmd(todayYmd, horizon);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const list = (names: string[]) =>
  names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/** Cards carrying a balance from month to month: the ones that are debt. */
export function carriedCards(f: Pick<PlanFacts, "cards">): PlanFacts["cards"] {
  return f.cards.filter((c) => !paidInFull(c));
}

export function buildActionPlan(f: PlanFacts, fmt: (cents: number) => string): PlanStep[] {
  const steps: PlanStep[] = [];
  const add = (step: Omit<PlanStep, "done"> & { done?: boolean }) => steps.push({ done: false, ...step });
  const factor = (id: FinancialScoreFactorId) => (f.score.status === "scored" ? f.score.factors.find((x) => x.id === id) ?? null : null);
  /** What can be put toward a goal each month at today's pace. */
  const capacity = Math.max(0, f.avgSavedCents, f.avgIncomeCents - f.avgSpendingCents);
  const monthsAt = (need: number) => (capacity > 0 ? Math.max(1, Math.ceil(need / capacity)) : null);
  const pace = (need: number) => {
    const m = monthsAt(need);
    return m === null ? "" : ` At ${fmt(capacity)} a month, your recent pace, that is about ${plural(m, "month")}.`;
  };
  const measured = f.monthsMeasured > 0;
  const span = plural(f.monthsMeasured, "month");

  // --- Cash flow ---------------------------------------------------------------------------
  if (measured) {
    const gap = f.avgSpendingCents - f.avgIncomeCents;
    if (gap > 0) {
      const big = f.topCategories.slice(0, 3).map((c) => `${c.name} (${fmt(c.avgCents)})`);
      add({
        horizon: 3,
        area: "Cash flow",
        title: `Close the gap of ${fmt(gap)} a month`,
        detail: `Over the last ${span} spending averaged ${fmt(f.avgSpendingCents)} a month against ${fmt(f.avgIncomeCents)} of income.${big.length ? ` The biggest categories are ${list(big)}.` : ""} Every other step depends on this one.`,
        priority: 100,
        amountCents: gap,
      });
    } else if (f.monthsInRed > 0) {
      add({
        horizon: 3,
        area: "Cash flow",
        title: "Even out the months that run short",
        detail: `${plural(f.monthsInRed, "month")} of the last ${f.monthsMeasured} spent more than came in. Setting money aside on payday for irregular costs evens this out.`,
        priority: 60,
      });
    } else if (f.monthsMeasured >= 3) {
      add({
        horizon: 3,
        area: "Cash flow",
        title: "Spend less than you earn",
        detail: `Every one of the last ${span} ended with money left over.`,
        priority: 5,
        done: true,
      });
    }
  }

  // --- Emergency fund ----------------------------------------------------------------------
  if (f.emergencyFundCents === null) {
    add({
      horizon: 3,
      area: "Emergency fund",
      title: "Record your chequing and savings balances",
      detail: "With no balances the plan cannot tell how long your savings would last. Enter them under Settings, Accounts.",
      priority: 70,
    });
  } else if (measured && f.avgSpendingCents > 0) {
    const fund = f.emergencyFundCents;
    const monthsCovered = fund / f.avgSpendingCents;
    const tiers: Array<{ months: number; title: string; minHorizon: PlanHorizon; priority: number }> = [
      { months: 1, title: "Save a starter emergency fund of one month's spending", minHorizon: 3, priority: 95 },
      { months: EMERGENCY_FUND_TARGET_MONTHS, title: `Grow the emergency fund to ${EMERGENCY_FUND_TARGET_MONTHS} months of spending`, minHorizon: 6, priority: 80 },
      { months: FULL_FUND_MONTHS, title: `Grow the emergency fund to ${FULL_FUND_MONTHS} months for a fuller cushion`, minHorizon: 12, priority: 35 },
    ];
    for (const tier of tiers) {
      const target = Math.round(tier.months * f.avgSpendingCents);
      if (fund >= target) {
        add({
          horizon: tier.minHorizon,
          area: "Emergency fund",
          title: tier.title,
          detail: `Chequing and savings hold ${fmt(fund)}, ${monthsText(monthsCovered)} of spending.`,
          priority: 5,
          done: true,
          amountCents: target,
        });
        continue;
      }
      const need = target - fund;
      const months = monthsAt(need);
      const horizon = Math.max(tier.minHorizon, months === null ? 24 : horizonFor(months)) as PlanHorizon;
      add({
        horizon,
        area: "Emergency fund",
        title: tier.title,
        detail: `The target is ${fmt(target)}; chequing and savings hold ${fmt(Math.max(0, fund))}, so ${fmt(need)} to go.${pace(need)}`,
        priority: tier.priority,
        amountCents: target,
      });
    }
  }

  // --- Debt --------------------------------------------------------------------------------
  const cards = carriedCards(f);
  const clearedCards = f.cards.filter(paidInFull);
  const cardTotal = cards.reduce((s, c) => s + c.balanceCents, 0);
  const loanTotal = f.loans.reduce((s, c) => s + c.balanceCents, 0);
  if (cards.length || f.loans.length) {
    add({
      horizon: 3,
      area: "Debt",
      title: "Write down each debt's interest rate and minimum payment",
      detail: "They are on your statements. The debt payoff planner template has a column for each, and a rate tells you which debt to pay first.",
      priority: 75,
    });
  }
  if (cards.length) {
    const months = monthsAt(cardTotal);
    const smallest = [...cards].sort((a, b) => a.balanceCents - b.balanceCents)[0];
    add({
      horizon: months === null ? 12 : horizonFor(months),
      area: "Debt",
      title: `Pay off ${cards.length === 1 ? cards[0].name : `${cards.length} credit cards`}: ${fmt(cardTotal)}`,
      detail: `Card interest is usually the dearest money you owe. Pay every minimum on time, then put anything extra on the highest rate${cards.length > 1 ? ` (or on ${smallest.name}, the smallest, to clear one sooner)` : ""}.${pace(cardTotal)}`,
      priority: 90,
      amountCents: cardTotal,
    });
  }
  if (clearedCards.length) {
    const names = list(clearedCards.map((c) => c.name));
    add({
      horizon: 3,
      area: "Debt",
      title: `Pay ${clearedCards.length === 1 ? clearedCards[0].name : "credit cards"} in full each month`,
      detail: `${names} ${clearedCards.length === 1 ? "owes" : "owe"} no more than ${clearedCards.length === 1 ? "its" : "their"} last two months of charges, so the statement is being cleared and no interest is running. Keep it up.`,
      priority: 5,
      done: true,
    });
  } else if (!cards.length && f.hasCardAccount) {
    add({
      horizon: 3,
      area: "Debt",
      title: "Pay credit cards in full each month",
      detail: "No card balance is carried. Keep paying the statement in full and cards cost nothing.",
      priority: 5,
      done: true,
    });
  }
  if (f.loans.length) {
    add({
      horizon: 24,
      area: "Debt",
      title: `Pay down ${f.loans.length === 1 ? f.loans[0].name : `${f.loans.length} loans`} ahead of schedule: ${fmt(loanTotal)}`,
      detail: "Once cards are clear and the emergency fund is in place, extra payments toward the principal shorten a loan and cut the interest. Check your lender allows them without a fee.",
      priority: 30,
      amountCents: loanTotal,
    });
  }

  // --- Bills -------------------------------------------------------------------------------
  if (f.overdueBills.length) {
    const total = f.overdueBills.reduce((s, b) => s + b.amountCents, 0);
    add({
      horizon: 3,
      area: "Bills",
      title: `Deal with ${plural(f.overdueBills.length, "overdue bill")}: ${fmt(total)}`,
      detail: `${list(f.overdueBills.slice(0, 4).map((b) => b.name))} ${f.overdueBills.length === 1 ? "is" : "are"} past due and not yet entered. Pay, then post ${f.overdueBills.length === 1 ? "it" : "them"} from the Recurring card, or skip ${f.overdueBills.length === 1 ? "it" : "them"} if already handled.`,
      priority: 85,
      amountCents: total,
    });
  }
  if (f.next30Bills.length) {
    const total = f.next30Bills.reduce((s, b) => s + b.amountCents, 0);
    const largest = [...f.next30Bills].sort((a, b) => b.amountCents - a.amountCents).slice(0, 3);
    add({
      horizon: 3,
      area: "Bills",
      title: `Have ${fmt(total)} ready for the next 30 days of bills`,
      detail: `${plural(f.next30Bills.length, "bill")} come due, the largest ${list(largest.map((b) => `${b.name} (${fmt(b.amountCents)})`))}. The bill calendar template puts each on its day.`,
      priority: 50,
      amountCents: total,
    });
  }
  if (f.irregularBills.length) {
    const monthly = f.irregularBills.reduce((s, b) => s + Math.ceil(b.amountCents / Math.max(1, b.monthsAway)), 0);
    add({
      horizon: 3,
      area: "Bills",
      title: `Set aside ${fmt(monthly)} a month for bills that come yearly or quarterly`,
      detail: `${list(f.irregularBills.slice(0, 4).map((b) => `${b.name} (${fmt(b.amountCents)})`))} ${f.irregularBills.length === 1 ? "is" : "are"} due in the next year. Saving toward ${f.irregularBills.length === 1 ? "it" : "them"} each month means no surprise. See the sinking funds template.`,
      priority: 55,
      amountCents: monthly,
      per: "month",
    });
  }
  const bills = factor("bills");
  if (bills?.suggestion) {
    add({ horizon: 6, area: "Bills", title: "Bring fixed bills under 35% of income", detail: bills.suggestion, priority: 55 });
  }
  if (f.recurringBills.count >= 3) {
    add({
      horizon: 6,
      area: "Bills",
      title: `Review your ${f.recurringBills.count} recurring bills and subscriptions`,
      detail: `Together they cost about ${fmt(f.recurringBills.monthlyCents)} a month, ${fmt(f.recurringBills.monthlyCents * 12)} a year. The subscription audit template lists each with its yearly cost and boxes for keep, cancel or find cheaper.`,
      priority: 35,
      amountCents: f.recurringBills.monthlyCents * 12,
      per: "year",
    });
  }

  // --- Budgets -----------------------------------------------------------------------------
  if (f.budgetCount === 0) {
    const unbudgeted = f.topCategories.filter((c) => !c.budgeted).slice(0, 3);
    add({
      horizon: 3,
      area: "Budgets",
      title: "Set budgets for your biggest spending categories",
      detail: unbudgeted.length
        ? `Start with ${list(unbudgeted.map((c) => `${c.name} (${fmt(c.avgCents)} a month on average)`))}, at or a little under what you spend now.`
        : "Start with the three categories you spend most on, at or a little under what you spend now.",
      priority: 65,
    });
  } else {
    const budgets = factor("budgets");
    if (budgets?.suggestion) {
      add({ horizon: 3, area: "Budgets", title: "Set budgets you can keep", detail: budgets.suggestion, priority: 60 });
    } else if (budgets) {
      add({ horizon: 3, area: "Budgets", title: "Keep to your budgets", detail: budgets.detail, priority: 5, done: true });
    }
    const unbudgeted = f.topCategories.filter((c) => !c.budgeted).slice(0, 2);
    if (unbudgeted.length && unbudgeted[0].avgCents > 0) {
      add({
        horizon: 6,
        area: "Budgets",
        title: `Add a budget for ${list(unbudgeted.map((c) => c.name))}`,
        detail: `${list(unbudgeted.map((c) => `${c.name} averages ${fmt(c.avgCents)} a month`))} with no budget to check against.`,
        priority: 30,
      });
    }
  }
  const trend = factor("trend");
  if (trend?.suggestion) {
    add({ horizon: 6, area: "Budgets", title: "Turn rising spending back down", detail: trend.suggestion, priority: 50 });
  }

  // --- Savings -----------------------------------------------------------------------------
  if (measured && f.avgIncomeCents > 0) {
    const rate = f.avgSavedCents / f.avgIncomeCents;
    const target = Math.round(TARGET_SAVINGS_RATE * f.avgIncomeCents);
    if (rate < TARGET_SAVINGS_RATE) {
      add({
        horizon: 6,
        area: "Savings",
        title: `Raise your savings to 20% of income, ${fmt(target)} a month`,
        detail: factor("savings")?.suggestion ?? `You save about ${Math.round(rate * 100)}% now.`,
        priority: 70,
        amountCents: target,
        per: "month",
      });
    } else {
      add({
        horizon: 6,
        area: "Savings",
        title: "Save 20% of income",
        detail: `You saved ${Math.round(rate * 100)}% over the last ${span}.`,
        priority: 5,
        done: true,
      });
    }
  }
  if (!f.hasSavingsTransferRule) {
    add({
      horizon: 3,
      area: "Savings",
      title: "Automate saving: a transfer to savings on payday",
      detail: "Money moved before it can be spent is the easiest saving there is. Set it up at your bank, then add it as a recurring transfer here so it shows in forecasts.",
      priority: 45,
    });
  }

  // --- Goals -------------------------------------------------------------------------------
  const open = f.goals.filter((g) => g.status !== "reached");
  for (const g of open) {
    const gfmt = (cents: number) => (g.currency === f.currency ? fmt(cents) : `${fromCents(cents).toFixed(2)} ${g.currency}`);
    if (g.status === "overdue") {
      add({
        horizon: 3,
        area: "Goals",
        title: `Set a new date for ${g.name}`,
        detail: `Its date has passed with ${gfmt(g.remainingCents)} still to go. Pick a date you can make, or lower the target.`,
        priority: 65,
        amountCents: g.remainingCents,
      });
      continue;
    }
    const needed = g.monthlyNeededCents !== null ? ` Put aside ${gfmt(g.monthlyNeededCents)} a month to make it.` : "";
    if (g.status === "behind") {
      add({
        horizon: 3,
        area: "Goals",
        title: `Get ${g.name} back on track`,
        detail: `It is behind the pace its date needs, with ${gfmt(g.remainingCents)} to go.${needed}`,
        priority: 68,
        amountCents: g.monthlyNeededCents,
        per: "month",
        byYmd: g.targetYmd,
      });
      continue;
    }
    add({
      horizon: g.monthsLeft === null ? 24 : horizonFor(g.monthsLeft),
      area: "Goals",
      title: `Reach ${g.name}: ${gfmt(g.remainingCents)} to go`,
      detail: g.targetYmd
        ? `${g.status === "on-track" ? "On track for its date." : "Has a date."}${needed}`
        : "No date set. A date turns it into a monthly amount you can plan around.",
      priority: 40,
      amountCents: g.remainingCents,
      byYmd: g.targetYmd,
    });
  }
  if (!open.length) {
    add({
      horizon: 6,
      area: "Goals",
      title: "Name a savings goal with a target and a date",
      detail: "A trip, a car, a down payment: a goal with a date becomes a monthly amount, and the app tracks it under Insights.",
      priority: 25,
    });
  }

  // --- Tax-free and registered room --------------------------------------------------------
  for (const r of f.room) {
    if (r.penaltyExcessCents > 0) {
      add({
        horizon: 3,
        area: "Tax-free room",
        title: `Withdraw the ${r.accountType} over-contribution of ${fmt(r.penaltyExcessCents)}`,
        detail: "The CRA charges 1% a month on an excess for as long as it stays in. Taking it out stops the charge.",
        priority: 98,
        amountCents: r.penaltyExcessCents,
      });
      continue;
    }
    if (!r.remainingCents || r.remainingCents <= 0) continue;
    const deadline = r.accountType === "RRSP" ? `${r.year + 1}-03-01` : `${r.year}-12-31`;
    const monthsToDeadline = Math.max(1, Math.round((Date.parse(deadline) - Date.parse(f.todayYmd)) / (30.44 * 86_400_000)));
    const why: Record<PlanRoom["accountType"], string> = {
      TFSA: "Growth inside a TFSA is never taxed, and unused room carries forward, so this is about using it, not losing it.",
      RRSP: `Contributions made by about March 1, ${r.year + 1} count against ${r.year} and lower that year's taxable income.`,
      FHSA: "Contributions are deductible and come out tax-free for a first home. Only $8,000 of unused room carries into next year.",
    };
    add({
      // TFSA room never expires; the others are worth using before their deadline.
      horizon: r.accountType === "TFSA" ? 12 : horizonFor(monthsToDeadline),
      area: "Tax-free room",
      title: `Use ${r.accountType} room: ${fmt(r.remainingCents)} left for ${r.year}`,
      detail: why[r.accountType],
      priority: r.accountType === "TFSA" ? 30 : 38,
      amountCents: r.remainingCents,
      byYmd: r.accountType === "TFSA" ? null : deadline,
    });
  }

  // --- Retirement --------------------------------------------------------------------------
  if (!f.hasRetirementAccount && measured && f.avgIncomeCents > 0) {
    add({
      horizon: 24,
      area: "Retirement",
      title: "Start saving for retirement",
      detail: `A common aim is 10 to 15% of income, about ${fmt(Math.round(f.avgIncomeCents * 0.1))} to ${fmt(Math.round(f.avgIncomeCents * 0.15))} a month for you${f.countryCode === "CA" ? ", in an RRSP or TFSA" : ""}. Check whether your employer matches contributions first: that match is free money.`,
      priority: 32,
    });
  }

  // --- Housekeeping ------------------------------------------------------------------------
  if (f.reviewQueueCount > 0) {
    add({
      horizon: 3,
      area: "Housekeeping",
      title: `Review ${plural(f.reviewQueueCount, "bank row")} waiting in the queue`,
      detail: "Until they are added or declined, the figures in this plan leave them out.",
      priority: 48,
    });
  }
  if (f.staleBalances.length) {
    add({
      horizon: 3,
      area: "Housekeeping",
      title: `Update ${f.staleBalances.length === 1 ? "the balance" : "balances"} for ${list(f.staleBalances.slice(0, 4))}${f.staleBalances.length > 4 ? ` and ${f.staleBalances.length - 4} more` : ""}`,
      detail: `${f.staleBalances.length === 1 ? "It has" : "They have"} no balance from the last ${STALE_BALANCE_DAYS} days, so net worth and the emergency fund may be off.`,
      priority: 40,
    });
  }
  add({
    horizon: 12,
    area: "Housekeeping",
    title: "Do a yearly check-up",
    detail: "Insurance (home or tenant, life, disability), will and beneficiaries, your credit report, and this year's tax slips and receipts in one place.",
    priority: 15,
  });

  return steps.sort((a, b) => a.horizon - b.horizon || Number(a.done) - Number(b.done) || b.priority - a.priority);
}

/** The steps to start with: the most pressing undone ones, whichever list they are in. */
export function nextSteps(steps: readonly PlanStep[], count = 3): PlanStep[] {
  return steps
    .filter((s) => !s.done)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, count);
}

/** A blank plan's lists: the usual milestones, in order, for anyone to work through. */
export const BLANK_PLAN: Record<PlanHorizon, Array<{ area: PlanArea; title: string }>> = {
  3: [
    { area: "Housekeeping", title: "List every account, balance and debt (net worth worksheet)" },
    { area: "Bills", title: "List every bill with its amount and due date (bill calendar)" },
    { area: "Cash flow", title: "Track every expense for one month (spending log)" },
    { area: "Budgets", title: "Write a budget for next month (budget worksheet)" },
    { area: "Emergency fund", title: "Save a starter emergency fund of one month's spending" },
    { area: "Debt", title: "Pay at least the minimum on every debt, on time" },
    { area: "Savings", title: "Set up an automatic transfer to savings on payday" },
  ],
  6: [
    { area: "Emergency fund", title: "Grow the emergency fund to 3 months of spending" },
    { area: "Debt", title: "Pay off the credit card with the highest rate" },
    { area: "Bills", title: "Review subscriptions; cancel or downgrade what you don't use" },
    { area: "Bills", title: "Start sinking funds for yearly and irregular bills" },
    { area: "Savings", title: "Raise savings toward 20% of income" },
  ],
  12: [
    { area: "Debt", title: "Pay off every credit card balance" },
    { area: "Tax-free room", title: "Use this year's tax-sheltered savings room" },
    { area: "Housekeeping", title: "Check insurance: home or tenant, car, life, disability" },
    { area: "Housekeeping", title: "Check your credit report for errors" },
    { area: "Housekeeping", title: "Make or update a will, power of attorney and beneficiaries" },
    { area: "Housekeeping", title: "File taxes and keep the slips and receipts together" },
  ],
  24: [
    { area: "Emergency fund", title: "Grow the emergency fund to 6 months of spending" },
    { area: "Debt", title: "Pay loans down ahead of schedule" },
    { area: "Retirement", title: "Save 10 to 15% of income for retirement" },
    { area: "Goals", title: "Save toward a big goal: a home, a car, education" },
    { area: "Housekeeping", title: "Review net worth once a year and compare" },
  ],
};

export function blankPlanSteps(): PlanStep[] {
  return PLAN_HORIZONS.flatMap((horizon) =>
    BLANK_PLAN[horizon].map((s, i) => ({ horizon, area: s.area, title: s.title, detail: "", priority: -i, done: false })),
  );
}

export type ActionPlan = {
  mode: "filled" | "blank";
  currency: string;
  todayYmd: string;
  /** The furthest horizon printed; the lists before it come too. */
  range: PlanHorizon;
  facts: PlanFacts | null;
  steps: PlanStep[];
};

export function stepsInRange(plan: ActionPlan): PlanStep[] {
  return plan.steps.filter((s) => s.horizon <= plan.range);
}

/** The plan as a CSV: one row per step, with Done ticked for steps already true. */
export function actionPlanCsv(plan: ActionPlan): string {
  const amount = (cents: number | null | undefined) => (cents === null || cents === undefined ? "" : fromCents(cents).toFixed(2));
  const rows = stepsInRange(plan).map((s) => [
    PLAN_HORIZON_LABELS[s.horizon],
    s.done ? "Yes" : "",
    s.area,
    s.title,
    s.detail,
    amount(s.amountCents),
    s.per ?? "",
    s.byYmd ?? "",
  ]);
  const blanks = PLAN_HORIZONS.filter((h) => h <= plan.range).flatMap((h) =>
    Array.from({ length: plan.mode === "blank" ? 3 : 1 }, () => [PLAN_HORIZON_LABELS[h], "", "", "", "", "", "", ""]),
  );
  return toCsv(["When", "Done", "Area", "Step", "Why", "Amount", "Per", "By"], [...rows, ...blanks]);
}
