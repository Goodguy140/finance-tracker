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
  {
    id: "subscriptions",
    title: "Subscription and bill audit",
    description: "Every recurring bill with what it costs a month and a year, and boxes for keep, cancel or find cheaper.",
    monthly: false,
  },
  {
    id: "sinking-funds",
    title: "Sinking funds planner",
    description: "Yearly and irregular costs with what to set aside each month so they never come as a surprise, and a log to record it.",
    monthly: false,
  },
  {
    id: "paycheque",
    title: "Paycheque planner",
    description: "Each pay in the month with the bills it has to cover before the next one, and room to split what is left.",
    monthly: true,
  },
  {
    id: "spending-log",
    title: "Spending log",
    description: "A page to write down every purchase as you make it, with the month's budgets and what is left of them at the top.",
    monthly: true,
  },
  {
    id: "accounts",
    title: "Accounts and contacts",
    description: "Where everything is: each account and its bank, insurance policies, the people to call and where papers are kept. For you, or for family in an emergency.",
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

/** Rows a table gets beyond any named ones, as room to add your own: the default, and the choices. */
export const EXTRA_BLANK_ROWS = 4;
export const EXTRA_ROW_OPTIONS = [0, 4, 8, 12] as const;

export function parseExtraRows(raw: string | null | undefined): number {
  const n = Number(raw);
  return raw ? ((EXTRA_ROW_OPTIONS as readonly number[]).includes(n) ? n : EXTRA_BLANK_ROWS) : EXTRA_BLANK_ROWS;
}

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

// --- Subscription audit -------------------------------------------------------------------

export type Cadence = "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY" | "BIENNIAL";

export const CADENCE_LABELS: Record<Cadence, string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Every 2 weeks",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  YEARLY: "Yearly",
  BIENNIAL: "Every 2 years",
};

const PER_YEAR: Record<Cadence, number> = { WEEKLY: 52, BIWEEKLY: 26, MONTHLY: 12, QUARTERLY: 4, YEARLY: 1, BIENNIAL: 0.5 };

/** What a recurring amount comes to over a year. */
export function yearlyCents(amountCents: number, cadence: Cadence): number {
  return Math.round(amountCents * PER_YEAR[cadence]);
}

export type SubscriptionRow = {
  name: string;
  categoryName: string;
  accountName: string;
  cadence: Cadence;
  amountCents: number;
  yearlyCents: number;
  next: Date | null;
};
export type SubscriptionSheet = { mode: TemplateMode; currency: string; rows: SubscriptionRow[] };

/** Recurring bills, dearest over a year first. */
export function subscriptionRows(rows: SubscriptionRow[]): SubscriptionRow[] {
  return [...rows].sort((a, b) => b.yearlyCents - a.yearlyCents || a.name.localeCompare(b.name));
}

// --- Sinking funds ------------------------------------------------------------------------

export type SinkingFundRow = {
  name: string;
  amountCents: number | null;
  due: Date | null;
  /** Monthly set-asides left before it is due, this month included; at least 1. */
  monthsToSave: number | null;
  perMonthCents: number | null;
};
export type SinkingFundSheet = { mode: TemplateMode; currency: string; startYm: string; funds: SinkingFundRow[] };

/** Costs that come round less than monthly: the bills a sinking fund is for. */
export const SINKING_CADENCES: ReadonlySet<Cadence> = new Set<Cadence>(["QUARTERLY", "YEARLY", "BIENNIAL"]);

/** Irregular costs most households have and no bill reminds them of, as named rows to fill in. */
export const SINKING_FUND_IDEAS = ["Car repairs and maintenance", "Home repairs", "Gifts and holidays", "Medical and dental", "Travel", "Clothing"];

/** A fund for a bill due on `due`: what to set aside each month from `currentYm` to have it all by then. */
export function sinkingFund(name: string, amountCents: number, due: Date, currentYm: string): SinkingFundRow {
  const dueIndex = due.getUTCFullYear() * 12 + due.getUTCMonth();
  const [y, m] = currentYm.split("-").map(Number);
  const months = Math.max(1, dueIndex - (y * 12 + m - 1));
  return { name, amountCents, due, monthsToSave: months, perMonthCents: Math.ceil(amountCents / months) };
}

// --- Paycheque planner --------------------------------------------------------------------

export type Paycheque = { date: Date; name: string; amountCents: number; paidOn: Date | null; bills: BillSheetItem[] };
export type PaychequeSheet = {
  mode: TemplateMode;
  ym: string;
  currency: string;
  pays: Paycheque[];
  /** Bills due before the month's first pay: last month's pay covers them. */
  beforeFirst: BillSheetItem[];
};

/**
 * Each bill under the pay it falls after: a pay covers everything due from its date until the
 * next pay. `items` is the bill calendar's month, income and bills together.
 */
export function groupByPaycheque(items: readonly BillSheetItem[]): { pays: Paycheque[]; beforeFirst: BillSheetItem[] } {
  const sorted = [...items].sort((a, b) => a.date.getTime() - b.date.getTime() || Number(a.type === "EXPENSE") - Number(b.type === "EXPENSE"));
  const pays: Paycheque[] = [];
  const beforeFirst: BillSheetItem[] = [];
  for (const item of sorted) {
    if (item.type === "INCOME") pays.push({ date: item.date, name: item.name, amountCents: item.amountCents, paidOn: item.paidOn, bills: [] });
    else (pays.length ? pays[pays.length - 1].bills : beforeFirst).push(item);
  }
  return { pays, beforeFirst };
}

// --- Spending log -------------------------------------------------------------------------

export type SpendingLogSheet = {
  mode: TemplateMode;
  ym: string;
  currency: string;
  /** Spent so far is only known for the month that is running; a future month has none. */
  running: boolean;
  budgets: Array<{ name: string; limitCents: number | null; spentCents: number | null }>;
};

/** Lines in the log beyond the empty-rows choice. */
export const SPENDING_LOG_ROWS = 20;

// --- Accounts and contacts ----------------------------------------------------------------

export type AccountsSheetRow = { name: string; typeLabel: string; institution: string; mask: string };
export type AccountsSheet = { mode: TemplateMode; currency: string; accounts: AccountsSheetRow[] };

export const BLANK_ACCOUNT_ROWS = ["Chequing", "Savings", "Credit card", "Investments", "Retirement savings", "Mortgage or loan"];
export const INSURANCE_ROWS = ["Home or tenant", "Car", "Life", "Disability", "Health and dental"];
export const CONTACT_ROWS = ["Executor", "Lawyer", "Accountant or tax preparer", "Financial advisor", "Employer benefits"];
export const KEPT_ROWS = ["Will", "Power of attorney", "Tax returns", "Insurance policies", "Property deeds and car ownership", "Password manager or safe"];

export type TemplateSheet =
  | { id: "budget"; sheet: BudgetSheet }
  | { id: "bills"; sheet: BillSheet }
  | { id: "goals"; sheet: GoalSheet }
  | { id: "debt"; sheet: DebtSheet }
  | { id: "net-worth"; sheet: NetWorthSheet }
  | { id: "subscriptions"; sheet: SubscriptionSheet }
  | { id: "sinking-funds"; sheet: SinkingFundSheet }
  | { id: "paycheque"; sheet: PaychequeSheet }
  | { id: "spending-log"; sheet: SpendingLogSheet }
  | { id: "accounts"; sheet: AccountsSheet };

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
export function templateCsv(t: TemplateSheet, extra: number = EXTRA_BLANK_ROWS): string {
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
          ...blankRows(extra, 8).map((r) => ["Income", ...r.slice(1)]),
          ...s.expenses.map(row("Spending")),
          ...blankRows(extra, 8).map((r) => ["Spending", ...r.slice(1)]),
        ].map((r) => [s.ym, ...r]),
      );
    }
    case "bills": {
      const s = t.sheet;
      return toCsv(
        ["Due date", "Bill", "Type", "Amount", "Account", "Paid on"],
        [
          ...s.items.map((i) => [ymd(i.date), i.name, i.type === "INCOME" ? "Income" : "Bill", amount(i.amountCents), i.accountName, ymd(i.paidOn)]),
          ...blankRows(extra + 4, 6),
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
          ...blankRows(extra, 8),
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
          ...blankRows(extra, 7).map((r) => ["Asset", ...r.slice(1)]),
          ...s.liabilities.map(row("Owed")),
          ...blankRows(extra, 7).map((r) => ["Owed", ...r.slice(1)]),
        ],
      );
    }
    case "subscriptions": {
      const s = t.sheet;
      return toCsv(
        ["Bill", "Category", "Account", "How often", "Amount", "A year", "Next due", "Keep, cancel or cheaper"],
        [
          ...s.rows.map((r) => [r.name, r.categoryName, r.accountName, CADENCE_LABELS[r.cadence], amount(r.amountCents), amount(r.yearlyCents), ymd(r.next), ""]),
          ...blankRows(s.mode === "blank" ? extra + 12 : extra, 8),
        ],
      );
    }
    case "sinking-funds": {
      const s = t.sheet;
      return toCsv(
        ["Fund", "Amount needed", "Due", "Months to save", "Set aside a month", "Saved so far"],
        [
          ...s.funds.map((f) => [f.name, amount(f.amountCents), ymd(f.due), f.monthsToSave === null ? "" : String(f.monthsToSave), amount(f.perMonthCents), ""]),
          ...SINKING_FUND_IDEAS.map((name) => [name, "", "", "", "", ""]),
          ...blankRows(extra, 6),
        ],
      );
    }
    case "paycheque": {
      const s = t.sheet;
      const bill = (pay: string) => (b: BillSheetItem) => [pay, ymd(b.date), b.name, amount(b.amountCents), b.accountName, ymd(b.paidOn)];
      return toCsv(
        ["Pay", "Due", "Bill", "Amount", "Account", "Paid on"],
        [
          ...s.beforeFirst.map(bill("Before the first pay")),
          ...s.pays.flatMap((p) => [
            [`${ymd(p.date)} ${p.name}`, ymd(p.date), `${p.name} (pay)`, amount(p.amountCents), "", ymd(p.paidOn)],
            ...p.bills.map(bill(`${ymd(p.date)} ${p.name}`)),
          ]),
          ...blankRows(extra, 6),
        ],
      );
    }
    case "spending-log": {
      return toCsv(
        ["Date", "What", "Category", "Amount", "Paid with"],
        Array.from({ length: SPENDING_LOG_ROWS + extra }, () => ["", "", "", "", ""]),
      );
    }
    case "accounts": {
      const s = t.sheet;
      return toCsv(
        ["Section", "Name", "Type", "Institution or company", "Ending in or policy number", "Contact or website", "Notes"],
        [
          ...s.accounts.map((a) => ["Account", a.name, a.typeLabel, a.institution, a.mask, "", ""]),
          ...blankRows(extra, 7).map((r) => ["Account", ...r.slice(1)]),
          ...INSURANCE_ROWS.map((name) => ["Insurance", name, "", "", "", "", ""]),
          ...CONTACT_ROWS.map((name) => ["Contact", name, "", "", "", "", ""]),
          ...KEPT_ROWS.map((name) => ["Where it is kept", name, "", "", "", "", ""]),
        ],
      );
    }
  }
}
