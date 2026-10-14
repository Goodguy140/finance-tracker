import { shiftYm } from "@/lib/dashboard-period";
import { toCsv } from "@/lib/csv";
import { fromCents } from "@/lib/money";
import type { ReportTx } from "@/lib/reports";

/**
 * Printable planning templates. Each comes "filled", from the user's own data, or "blank", to
 * fill in by hand; and as a PDF to print or a CSV to open in a spreadsheet. A filled template
 * still leaves the columns that are the user's to decide (planned amounts, what was actually
 * paid) empty: it is a worksheet, not a report.
 */
export const TEMPLATES = [
  {
    id: "budget",
    title: "Monthly budget worksheet",
    description: "Plan a month: income and every spending category, with your budget, last month and 3-month average beside the space to plan.",
    monthly: true,
  },
  {
    id: "bills",
    title: "Bill calendar",
    description: "A month on one page with each bill on its due day, and a checklist to tick off as they are paid.",
    monthly: true,
  },
  {
    id: "goals",
    title: "Savings goal tracker",
    description: "Each goal with its target, what is saved and what it needs a month, and a year of monthly deposits to record.",
    monthly: false,
  },
  {
    id: "debt",
    title: "Debt payoff planner",
    description: "Your cards and loans with their balances, room for rates and minimums, and a payment log to watch them shrink.",
    monthly: false,
  },
  {
    id: "net-worth",
    title: "Net worth worksheet",
    description: "Every account with its latest balance and a column to write today's, totalled into assets, owed and net worth.",
    monthly: false,
  },
] as const;

export type TemplateId = (typeof TEMPLATES)[number]["id"];
export type TemplateMode = "filled" | "blank";
export type TemplateFormat = "pdf" | "csv";

export function findTemplate(id: string) {
  return TEMPLATES.find((t) => t.id === id) ?? null;
}

export function parseTemplateMode(raw: string | null | undefined): TemplateMode {
  return raw === "blank" ? "blank" : "filled";
}

export function parseTemplateFormat(raw: string | null | undefined): TemplateFormat {
  return raw === "csv" ? "csv" : "pdf";
}

/** A monthly template covers this month or next; anything else asked for falls back to this month. */
export function resolveTemplateMonth(raw: string | null | undefined, currentYm: string): string {
  return raw === shiftYm(currentYm, 1) ? raw : currentYm;
}

/** Rows a blank table gets beyond any named ones, as room to add your own. */
export const EXTRA_BLANK_ROWS = 4;

// --- Budget worksheet ---------------------------------------------------------------------

export type BudgetSheetRow = {
  name: string;
  /** The budget for the month, rollover included; for income, what recurring income expects. */
  plannedCents: number | null;
  /** Rollover carried into the month, included in `plannedCents`. */
  carryCents: number;
  lastMonthCents: number | null;
  averageCents: number | null;
};

export type BudgetSheet = {
  mode: TemplateMode;
  ym: string;
  /**
   * The full months the history columns cover, oldest first: the ones before the current
   * month, whichever month is being planned, so a month still running never skews them.
   */
  historyMonths: string[];
  currency: string;
  income: BudgetSheetRow[];
  expenses: BudgetSheetRow[];
};

/** Months the worksheet averages over: the three full months before this one. */
export const BUDGET_AVERAGE_MONTHS = 3;

/**
 * Income and spending per category for each of `months`, keyed `${ym}|${categoryId}`,
 * split expenses counted in each part's category. Refunds (negative expenses) reduce their
 * category, as everywhere else.
 */
export function amountsByMonthAndCategory(txs: readonly ReportTx[], months: readonly string[]): {
  income: Map<string, number>;
  expense: Map<string, number>;
} {
  const wanted = new Set(months);
  const income = new Map<string, number>();
  const expense = new Map<string, number>();
  const add = (map: Map<string, number>, key: string, cents: number) => map.set(key, (map.get(key) ?? 0) + cents);
  for (const tx of txs) {
    const ym = tx.date.toISOString().slice(0, 7);
    if (!wanted.has(ym)) continue;
    if (tx.type === "INCOME") add(income, `${ym}|${tx.categoryId}`, tx.amountCents);
    else if (tx.type === "EXPENSE") {
      const parts = tx.splits.length ? tx.splits : [{ categoryId: tx.categoryId, amountCents: tx.amountCents }];
      for (const part of parts) add(expense, `${ym}|${part.categoryId}`, part.amountCents);
    }
  }
  return { income, expense };
}

/**
 * One worksheet row per category: the month's plan, last month and the average of the full
 * months before it. Categories with nothing anywhere still get a row, last, so the sheet has a
 * line for each one the user keeps.
 */
export function budgetSheetRows(
  categories: ReadonlyArray<{ id: string; name: string }>,
  amounts: ReadonlyMap<string, number>,
  previousMonths: readonly string[],
  planned: ReadonlyMap<string, { cents: number; carryCents: number }>,
): BudgetSheetRow[] {
  const lastYm = previousMonths[previousMonths.length - 1];
  return categories
    .map((c) => {
      const values = previousMonths.map((ym) => amounts.get(`${ym}|${c.id}`) ?? 0);
      const total = values.reduce((s, v) => s + v, 0);
      const plan = planned.get(c.id);
      return {
        name: c.name,
        plannedCents: plan ? plan.cents : null,
        carryCents: plan?.carryCents ?? 0,
        lastMonthCents: amounts.get(`${lastYm}|${c.id}`) ?? 0,
        averageCents: Math.round(total / Math.max(1, previousMonths.length)),
      };
    })
    .sort(
      (a, b) =>
        Number(b.plannedCents !== null || b.averageCents !== 0) - Number(a.plannedCents !== null || a.averageCents !== 0) ||
        (b.averageCents ?? 0) - (a.averageCents ?? 0) ||
        a.name.localeCompare(b.name),
    );
}

// --- Bill calendar ------------------------------------------------------------------------

export type BillSheetItem = {
  /** The due date. */
  date: Date;
  name: string;
  type: "EXPENSE" | "INCOME";
  amountCents: number;
  accountName: string;
  /** When it was posted, for an occurrence already entered this month; null while still to come. */
  paidOn: Date | null;
};
export type BillSheet = { mode: TemplateMode; ym: string; currency: string; items: BillSheetItem[] };

// --- Savings goals ------------------------------------------------------------------------

export type GoalSheetGoal = {
  name: string;
  currency: string;
  targetCents: number;
  savedCents: number | null;
  remainingCents: number;
  targetYmd: string | null;
  monthlyNeededCents: number | null;
  accountName: string | null;
};
export type GoalSheet = { mode: TemplateMode; currency: string; startYm: string; goals: GoalSheetGoal[] };

/** Months the tracker grid runs for, from the current one. */
export const GOAL_TRACKER_MONTHS = 12;

// --- Debts and net worth ------------------------------------------------------------------

export type BalanceSheetRow = {
  name: string;
  typeLabel: string;
  currency: string;
  balanceCents: number | null;
  asOf: Date | null;
};
export type DebtSheet = { mode: TemplateMode; currency: string; startYm: string; debts: BalanceSheetRow[] };
export type NetWorthSheet = { mode: TemplateMode; currency: string; assets: BalanceSheetRow[]; liabilities: BalanceSheetRow[] };

/** Generic rows for a blank sheet: nothing of the user's, just the usual kinds of account. */
export const BLANK_ASSET_ROWS = ["Chequing", "Savings", "Investments", "Retirement savings", "Home", "Vehicle"];
export const BLANK_DEBT_ROWS = ["Credit card", "Line of credit", "Car loan", "Student loan", "Mortgage"];

export type TemplateSheet =
  | { id: "budget"; sheet: BudgetSheet }
  | { id: "bills"; sheet: BillSheet }
  | { id: "goals"; sheet: GoalSheet }
  | { id: "debt"; sheet: DebtSheet }
  | { id: "net-worth"; sheet: NetWorthSheet };

// --- CSV ----------------------------------------------------------------------------------

/** A plain decimal a spreadsheet reads as a number; empty for nothing. */
function amount(cents: number | null | undefined): string {
  return cents === null || cents === undefined ? "" : fromCents(cents).toFixed(2);
}

function ymd(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "";
}

const blankRows = (count: number, width: number): string[][] => Array.from({ length: count }, () => Array(width).fill(""));

/** The template as a CSV: the same rows as the PDF, with its write-in columns left empty. */
export function templateCsv(t: TemplateSheet): string {
  switch (t.id) {
    case "budget": {
      const s = t.sheet;
      const row = (section: string) => (r: BudgetSheetRow) => [
        section,
        r.name,
        amount(r.plannedCents),
        amount(r.lastMonthCents),
        amount(r.averageCents),
        "",
        "",
        "",
      ];
      return toCsv(
        ["Month", "Section", "Name", "Budget or expected", s.historyMonths.at(-1) ?? "Last month", `${BUDGET_AVERAGE_MONTHS}-month average`, "Planned", "Actual", "Difference"],
        [
          ...s.income.map(row("Income")),
          ...blankRows(s.mode === "blank" ? EXTRA_BLANK_ROWS : 0, 8).map((r) => ["Income", ...r.slice(1)]),
          ...s.expenses.map(row("Spending")),
          ...blankRows(EXTRA_BLANK_ROWS, 8).map((r) => ["Spending", ...r.slice(1)]),
        ].map((r) => [s.ym, ...r]),
      );
    }
    case "bills": {
      const s = t.sheet;
      return toCsv(
        ["Due date", "Bill", "Type", "Amount", "Account", "Paid on"],
        [
          ...s.items.map((i) => [ymd(i.date), i.name, i.type === "INCOME" ? "Income" : "Bill", amount(i.amountCents), i.accountName, ymd(i.paidOn)]),
          ...blankRows(EXTRA_BLANK_ROWS * 2, 6),
        ],
      );
    }
    case "goals": {
      const s = t.sheet;
      const months = Array.from({ length: GOAL_TRACKER_MONTHS }, (_, i) => shiftYm(s.startYm, i));
      const goals = s.goals.length ? s.goals : null;
      const rows = goals
        ? goals.flatMap((g) =>
            months.map((ym, i) => [
              g.name,
              amount(g.targetCents),
              g.targetYmd ?? "",
              i === 0 ? amount(g.savedCents) : "",
              ym,
              amount(g.monthlyNeededCents),
              "",
              "",
            ]),
          )
        : blankRows(GOAL_TRACKER_MONTHS * 2, 8);
      return toCsv(["Goal", "Target", "Target date", "Saved so far", "Month", "Planned deposit", "Deposited", "Balance"], rows);
    }
    case "debt": {
      const s = t.sheet;
      return toCsv(
        ["Debt", "Type", "Balance", "Balance as of", "Interest rate %", "Minimum payment", "Extra payment", "Payoff order"],
        [
          ...s.debts.map((d) => [d.name, d.typeLabel, amount(d.balanceCents), ymd(d.asOf), "", "", "", ""]),
          ...blankRows(EXTRA_BLANK_ROWS, 8),
        ],
      );
    }
    case "net-worth": {
      const s = t.sheet;
      const row = (kind: string) => (r: BalanceSheetRow) => [kind, r.name, r.typeLabel, r.currency, amount(r.balanceCents), ymd(r.asOf), ""];
      return toCsv(
        ["Kind", "Account", "Type", "Currency", "Last balance", "As of", "Balance today"],
        [
          ...s.assets.map(row("Asset")),
          ...blankRows(EXTRA_BLANK_ROWS, 7).map((r) => ["Asset", ...r.slice(1)]),
          ...s.liabilities.map(row("Owed")),
          ...blankRows(EXTRA_BLANK_ROWS, 7).map((r) => ["Owed", ...r.slice(1)]),
        ],
      );
    }
  }
}
