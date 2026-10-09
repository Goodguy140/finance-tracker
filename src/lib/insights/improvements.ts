import { OTHER_CATEGORY_ALIASES } from "@/lib/plaid/category-map";
import { categoryAmounts } from "./savings";
import type { Insight, InsightBudget, InsightTx } from "./types";
import { daysAgo, evidenceIds, previousFullMonths, ymOf, type MoneyFormatter } from "./util";

/**
 * Broader suggestions drawn from the shape of the whole ledger rather than a single merchant:
 * how much of the income is left over, which categories are climbing, where a budget would
 * help, and where the data itself is too thin to analyse.
 */

export type ImprovementsInput = {
  txs: InsightTx[];
  budgets: InsightBudget[];
  now: Date;
  fmt: MoneyFormatter;
};

/**
 * Money moved to savings or investments is logged as an expense by many users; counting it as
 * spending would make the most careful savers look like the worst ones.
 */
const SAVINGS_CATEGORY = /saving|invest|transfer|tfsa|rrsp|fhsa|貯金|投資/i;

export function suggestImprovements(input: ImprovementsInput): Insight[] {
  return [
    ...savingsRate(input),
    ...risingCategories(input),
    ...unbudgetedCategories(input),
    ...dataHygiene(input),
  ];
}

type MonthlyCategorySpend = Map<string, { name: string; byMonth: Map<string, number> }>;

function monthlySpendByCategory(txs: InsightTx[], months: Set<string>): MonthlyCategorySpend {
  const out: MonthlyCategorySpend = new Map();
  for (const tx of txs) {
    if (tx.type !== "EXPENSE") continue;
    const ym = ymOf(tx.date);
    if (!months.has(ym)) continue;
    for (const part of categoryAmounts(tx)) {
      if (SAVINGS_CATEGORY.test(part.categoryName)) continue;
      let entry = out.get(part.categoryId);
      if (!entry) {
        entry = { name: part.categoryName, byMonth: new Map() };
        out.set(part.categoryId, entry);
      }
      entry.byMonth.set(ym, (entry.byMonth.get(ym) ?? 0) + part.amountCents);
    }
  }
  return out;
}

// --- Savings rate ----------------------------------------------------------------------------

function savingsRate({ txs, now, fmt }: ImprovementsInput): Insight[] {
  const monthList = previousFullMonths(now, 3);
  const months = new Set(monthList);
  let income = 0;
  let spending = 0;
  let savedExplicitly = 0;
  for (const tx of txs) {
    if (!months.has(ymOf(tx.date))) continue;
    if (tx.type === "INCOME") income += tx.amountCents;
    else {
      for (const part of categoryAmounts(tx)) {
        if (SAVINGS_CATEGORY.test(part.categoryName)) savedExplicitly += part.amountCents;
        else spending += part.amountCents;
      }
    }
  }
  if (income <= 0 || spending <= 0) return [];
  const rate = (income - spending) / income;
  const latest = monthList[monthList.length - 1];
  const monthlyGap = Math.round((spending - income) / 3);

  if (rate < 0) {
    return [
      {
        key: `improve:savings-rate:${latest}`,
        section: "improvement",
        severity: "high",
        title: "Spending ran ahead of income",
        body:
          `Over the last three months spending was about ${fmt(monthlyGap)} a month more than income. ` +
          `The rising categories and savings ideas on this page are the quickest places to close the gap.`,
        monthlyCents: monthlyGap,
        evidenceTxIds: [],
      },
    ];
  }
  if (rate < 0.1) {
    const target = Math.round((income * 0.1 - (income - spending)) / 3);
    const saved = savedExplicitly > 0 ? ` (not counting ${fmt(Math.round(savedExplicitly / 3))} a month you moved to savings)` : "";
    return [
      {
        key: `improve:savings-rate:${latest}`,
        section: "improvement",
        severity: "medium",
        title: `About ${Math.max(0, Math.round(rate * 100))}% of income left over`,
        body:
          `Over the last three months, about ${Math.round(rate * 100)}% of income was left after spending${saved}. ` +
          `A common goal is 10–20%; trimming about ${fmt(target)} a month would reach 10%.`,
        monthlyCents: target,
        evidenceTxIds: [],
      },
    ];
  }
  return [];
}

// --- Categories trending up ------------------------------------------------------------------

const RISE_MIN_PCT = 0.25;
const RISE_MIN_CENTS = 5_000;

function risingCategories({ txs, now, fmt }: ImprovementsInput): Insight[] {
  const monthList = previousFullMonths(now, 4);
  const latest = monthList[3];
  const prior = monthList.slice(0, 3);
  const spend = monthlySpendByCategory(txs, new Set(monthList));
  const out: Insight[] = [];
  for (const [categoryId, entry] of spend) {
    const current = entry.byMonth.get(latest) ?? 0;
    const priorAvg = prior.reduce((s, ym) => s + (entry.byMonth.get(ym) ?? 0), 0) / prior.length;
    if (priorAvg <= 0) continue;
    const rise = current - priorAvg;
    if (rise < RISE_MIN_CENTS || rise < priorAvg * RISE_MIN_PCT) continue;
    const evidence = txs.filter(
      (tx) => ymOf(tx.date) === latest && categoryAmounts(tx).some((p) => p.categoryId === categoryId),
    );
    out.push({
      key: `improve:rising:${categoryId}:${latest}`,
      section: "improvement",
      severity: rise >= 20_000 ? "medium" : "low",
      title: `${entry.name} is up ${Math.round((rise / priorAvg) * 100)}%`,
      body:
        `Last month's ${entry.name} spending was ${fmt(current)}, against a ${fmt(Math.round(priorAvg))} average ` +
        `over the three months before. Worth a look at what changed.`,
      monthlyCents: Math.round(rise),
      evidenceTxIds: evidenceIds(evidence, 8),
    });
  }
  return out.sort((a, b) => (b.monthlyCents ?? 0) - (a.monthlyCents ?? 0)).slice(0, 3);
}

// --- Steady spending with no budget ----------------------------------------------------------

const UNBUDGETED_MIN_MONTHLY_CENTS = 5_000;
/** Month-to-month variation below this is a fixed bill; a budget adds nothing there. */
const FIXED_COST_VARIATION = 0.05;

function unbudgetedCategories({ txs, budgets, now, fmt }: ImprovementsInput): Insight[] {
  const monthList = previousFullMonths(now, 3);
  const budgeted = new Set(budgets.map((b) => b.categoryId));
  const spend = monthlySpendByCategory(txs, new Set(monthList));
  const out: Insight[] = [];
  for (const [categoryId, entry] of spend) {
    if (budgeted.has(categoryId)) continue;
    const values = monthList.map((ym) => entry.byMonth.get(ym) ?? 0);
    if (values.some((v) => v <= 0)) continue;
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    if (avg < UNBUDGETED_MIN_MONTHLY_CENTS) continue;
    const spread = (Math.max(...values) - Math.min(...values)) / avg;
    if (spread < FIXED_COST_VARIATION) continue;
    // A round figure a little under the average: a budget that is never tight teaches nothing.
    const suggested = Math.max(1_000, Math.round((avg * 0.9) / 1_000) * 1_000);
    out.push({
      key: `improve:budget:${categoryId}`,
      section: "improvement",
      severity: "low",
      title: `No budget for ${entry.name}`,
      body:
        `You spend on ${entry.name} every month — about ${fmt(Math.round(avg))} on average — but have no budget ` +
        `for it. A limit of around ${fmt(suggested)} would flag the months that run over.`,
      monthlyCents: Math.round(avg),
      evidenceTxIds: [],
      action: { kind: "link", href: "/settings/categories", label: "Set a budget" },
    });
  }
  return out.sort((a, b) => (b.monthlyCents ?? 0) - (a.monthlyCents ?? 0)).slice(0, 3);
}

// --- Data quality ----------------------------------------------------------------------------

const CATCH_ALL = new Set(OTHER_CATEGORY_ALIASES.map((name) => name.toLowerCase()));
const HYGIENE_WINDOW_DAYS = 90;

function dataHygiene({ txs, now }: ImprovementsInput): Insight[] {
  const since = daysAgo(now, HYGIENE_WINDOW_DAYS);
  const recent = txs.filter((tx) => tx.type === "EXPENSE" && tx.date >= since);
  if (recent.length < 10) return [];
  const out: Insight[] = [];

  const uncategorized = recent.filter((tx) => tx.splits.length === 0 && CATCH_ALL.has(tx.categoryName.toLowerCase()));
  if (uncategorized.length >= 5 && uncategorized.length / recent.length > 0.15) {
    out.push({
      key: "improve:uncategorized",
      section: "improvement",
      severity: "low",
      title: `${uncategorized.length} recent expenses are in a catch-all category`,
      body:
        `${Math.round((uncategorized.length / recent.length) * 100)}% of the last ${HYGIENE_WINDOW_DAYS} days' ` +
        `expenses are filed under a catch-all, which hides them from category budgets and from these insights. ` +
        `A few transaction rules would file the regulars automatically.`,
      evidenceTxIds: evidenceIds(uncategorized),
      action: { kind: "link", href: "/settings/rules", label: "Create rules" },
    });
  }

  const untitled = recent.filter((tx) => !tx.title?.trim());
  if (untitled.length >= 10 && untitled.length / recent.length >= 0.25) {
    out.push({
      key: "improve:untitled",
      section: "improvement",
      severity: "low",
      title: `${untitled.length} recent expenses have no title`,
      body:
        `Without a title there is no merchant to recognise, so recurring charges and repeat purchases among them ` +
        `cannot be spotted. Adding titles — or linking a bank — makes these insights much sharper.`,
      evidenceTxIds: evidenceIds(untitled),
    });
  }
  return out;
}
