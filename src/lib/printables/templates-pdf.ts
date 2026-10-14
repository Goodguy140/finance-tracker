import { shiftYm } from "@/lib/dashboard-period";
import { moneyFormatter, printDate, printDay, printMonth, printMonthShort, printYmd } from "./format";
import { INK, PrintDoc, type Cell } from "./pdf-doc";
import {
  BUDGET_AVERAGE_MONTHS,
  EXTRA_BLANK_ROWS,
  findTemplate,
  GOAL_TRACKER_MONTHS,
  type BalanceSheetRow,
  type BudgetSheet,
  type BillSheet,
  type DebtSheet,
  type GoalSheet,
  type NetWorthSheet,
  type TemplateSheet,
} from "./templates";

/** Handwriting needs taller rows than print. */
const WRITE_ROW = 20;

const blank = (count: number, width: number): Cell[][] => Array.from({ length: count }, () => Array<Cell>(width).fill(""));

export async function renderTemplatePdf(t: TemplateSheet, meta: { todayYmd: string }): Promise<Uint8Array> {
  const info = findTemplate(t.id)!;
  const filled = t.sheet.mode === "filled";
  const doc = await PrintDoc.create({
    title: info.title,
    footer: filled
      ? `${info.title}, filled in from your data on ${printYmd(meta.todayYmd)}. Amounts in ${t.sheet.currency}.`
      : `${info.title}. Amounts in ${t.sheet.currency}.`,
  });
  switch (t.id) {
    case "budget":
      budget(doc, t.sheet);
      break;
    case "bills":
      bills(doc, t.sheet);
      break;
    case "goals":
      goals(doc, t.sheet);
      break;
    case "debt":
      debt(doc, t.sheet);
      break;
    case "net-worth":
      netWorth(doc, t.sheet);
      break;
  }
  return doc.finish();
}

function budget(doc: PrintDoc, s: BudgetSheet) {
  const fmt = moneyFormatter(s.currency);
  const filled = s.mode === "filled";
  const money = (cents: number | null) => (cents === null ? "" : fmt(cents));
  doc.title("Monthly budget worksheet", [
    printMonth(s.ym),
    filled
      ? `Budgets and history from your data; plan and record in the empty columns. The average is over ${printMonthShort(s.historyMonths[0])} to ${printMonthShort(s.historyMonths[s.historyMonths.length - 1])}.`
      : "Write what you expect in Planned, then fill in Actual as the month goes.",
  ]);

  const columns = (first: string, planned: string) => [
    { label: first, weight: 4 },
    ...(filled
      ? [
          { label: planned, weight: 2, align: "right" as const },
          { label: printMonthShort(s.historyMonths[s.historyMonths.length - 1]), weight: 2, align: "right" as const },
          { label: `${BUDGET_AVERAGE_MONTHS}-mo average`, weight: 2, align: "right" as const },
        ]
      : []),
    { label: "Planned", weight: 2, align: "right" as const },
    { label: "Actual", weight: 2, align: "right" as const },
    { label: "Difference", weight: 2, align: "right" as const },
  ];
  const rows = (list: BudgetSheet["income"]): Cell[][] => [
    ...list.map((r) => [
      r.name,
      ...(filled
        ? [
            r.carryCents
              ? { text: `${money(r.plannedCents)}*`, color: INK.text }
              : money(r.plannedCents),
            { text: money(r.lastMonthCents), color: INK.muted },
            { text: money(r.averageCents), color: INK.muted },
          ]
        : []),
      "",
      "",
      "",
    ]),
    ...blank(EXTRA_BLANK_ROWS, filled ? 7 : 4),
  ];
  const sum = (list: BudgetSheet["income"], key: "plannedCents" | "lastMonthCents" | "averageCents") =>
    list.reduce((total, r) => total + (r[key] ?? 0), 0);
  const totals = (list: BudgetSheet["income"]): Cell[] =>
    filled
      ? ["Total", fmt(sum(list, "plannedCents")), fmt(sum(list, "lastMonthCents")), fmt(sum(list, "averageCents")), "", "", ""]
      : ["Total", "", "", ""];

  doc.section("Income", filled ? "Expected is what your recurring income entries put in this month." : undefined, 80);
  doc.table({ columns: columns("Source", "Expected"), rows: rows(s.income), totals: totals(s.income), rowHeight: WRITE_ROW, grid: true });

  doc.section("Spending", undefined, 80);
  doc.table({ columns: columns("Category", "Budget"), rows: rows(s.expenses), totals: totals(s.expenses), rowHeight: WRITE_ROW, grid: true });
  if (filled && s.expenses.some((r) => r.carryCents)) {
    doc.paragraph("* Includes rollover carried in from earlier months.", { size: 8.5, color: INK.muted });
  }

  doc.section("The month in one line", undefined, 90);
  if (filled) {
    const income = sum(s.income, "averageCents");
    const spending = sum(s.expenses, "averageCents");
    doc.paragraph(
      `From ${printMonthShort(s.historyMonths[0])} to ${printMonthShort(s.historyMonths[s.historyMonths.length - 1])} you averaged ${fmt(income)} income and ${fmt(spending)} spending a month, ` +
        `${income - spending >= 0 ? `${fmt(income - spending)} left over` : `${fmt(spending - income)} more out than in`}.`,
      { size: 9.5, color: INK.muted },
    );
  }
  doc.writeLines(["Total income planned", "Total spending planned", "Left to save or invest", "Actually saved"], { columns: 2 });
}

function bills(doc: PrintDoc, s: BillSheet) {
  const fmt = moneyFormatter(s.currency);
  const filled = s.mode === "filled";
  doc.title("Bill calendar", [
    printMonth(s.ym),
    filled ? "Bills and income from your recurring entries. Tick each one off as it is paid." : "Write each bill on its due day, then list them below to tick off.",
  ]);
  const byDay = new Map<number, string[]>();
  for (const item of s.items) {
    const day = item.date.getUTCDate();
    const text = `${item.type === "INCOME" ? "+" : ""}${fmt(item.amountCents)} ${item.name}`;
    byDay.set(day, [...(byDay.get(day) ?? []), text]);
  }
  doc.calendar(s.ym, byDay);

  doc.section("Checklist", undefined, 80);
  const bills = s.items.filter((i) => i.type === "EXPENSE");
  doc.table({
    columns: [
      { label: "Due", weight: 2.2 },
      { label: "Bill", weight: 4 },
      { label: "Account", weight: 3 },
      { label: "Amount", weight: 2, align: "right" },
      { label: "Paid on", weight: 2 },
      { label: "Paid", weight: 1, align: "center" },
    ],
    rows: [
      ...s.items.map((i): Cell[] => [
        printDay(i.date),
        i.type === "INCOME" ? { text: `${i.name} (income)`, color: INK.positive } : i.name,
        { text: i.accountName, color: INK.muted },
        i.type === "INCOME" ? { text: `+${fmt(i.amountCents)}`, color: INK.positive } : fmt(i.amountCents),
        { text: i.paidOn ? printDate(i.paidOn) : "", color: INK.muted },
        { text: "", checkbox: true, checked: i.paidOn !== null },
      ]),
      ...Array.from({ length: filled ? EXTRA_BLANK_ROWS : 14 }, (): Cell[] => ["", "", "", "", "", { text: "", checkbox: true }]),
    ],
    totals: filled && bills.length ? ["", `${bills.length} bill${bills.length === 1 ? "" : "s"}`, "", fmt(bills.reduce((t, b) => t + b.amountCents, 0)), "", ""] : undefined,
    rowHeight: WRITE_ROW,
    grid: true,
  });
}

function goals(doc: PrintDoc, s: GoalSheet) {
  const months = Array.from({ length: GOAL_TRACKER_MONTHS }, (_, i) => shiftYm(s.startYm, i));
  const filled = s.mode === "filled";
  doc.title("Savings goal tracker", [
    filled ? "Your goals, with what each needs a month to make its date. Record each month's deposit and the balance." : "One goal per block. Record each month's deposit and the balance.",
  ]);
  const grid = (planned: string, firstBalance: string, dated: boolean) =>
    doc.table({
      columns: [
        { label: "Month", weight: 2.5 },
        { label: "Planned", weight: 2, align: "right" },
        { label: "Deposited", weight: 2, align: "right" },
        { label: "Balance", weight: 2, align: "right" },
        { label: "Done", weight: 1, align: "center" },
      ],
      rows: (dated ? months : months.map(() => "")).map((ym, i): Cell[] => [
        ym ? printMonthShort(ym) : "",
        { text: planned, color: INK.muted },
        "",
        i === 0 && firstBalance ? { text: `Start: ${firstBalance}`, color: INK.muted } : "",
        { text: "", checkbox: true },
      ]),
      rowHeight: 18,
      grid: true,
    });

  if (!filled || s.goals.length === 0) {
    if (filled) doc.paragraph("You have no savings goals in progress, so this is a blank tracker. Add goals under Settings, Savings goals.", { size: 9.5, color: INK.muted });
    for (let i = 0; i < 2; i++) {
      if (i > 0) doc.newPage();
      doc.section("Goal", undefined, 300);
      doc.writeLines(["Saving for", "Target amount", "By (date)", "Saved so far", "Still to go", "Needed each month"], { columns: 2 });
      grid("", "", false);
    }
    return;
  }

  s.goals.forEach((g, i) => {
    const fmt = moneyFormatter(g.currency);
    if (i > 0) doc.newPage();
    doc.section(g.name, g.accountName ? `Follows the balance of ${g.accountName}.` : undefined, 300);
    doc.facts([
      ["Target", fmt(g.targetCents)],
      ["By", g.targetYmd ? printYmd(g.targetYmd) : "No date set"],
      ["Saved so far", g.savedCents === null ? "No balance yet" : fmt(g.savedCents)],
      ["Still to go", fmt(g.remainingCents)],
      ["Needed a month", g.monthlyNeededCents === null ? "-" : fmt(g.monthlyNeededCents)],
    ]);
    grid(g.monthlyNeededCents === null ? "" : fmt(g.monthlyNeededCents), g.savedCents === null ? "" : fmt(g.savedCents), true);
  });
}

function balanceRows(rows: BalanceSheetRow[], filled: boolean, extra: number): Cell[][] {
  return [
    ...rows.map((r): Cell[] => [
      r.name,
      ...(filled
        ? [
            { text: r.typeLabel, color: INK.muted },
            r.balanceCents === null ? "" : moneyFormatter(r.currency)(r.balanceCents),
            { text: r.asOf ? printDate(r.asOf) : "", color: INK.muted },
          ]
        : []),
      "",
    ]),
    ...blank(extra, filled ? 5 : 2),
  ];
}

function debt(doc: PrintDoc, s: DebtSheet) {
  const fmt = moneyFormatter(s.currency);
  const filled = s.mode === "filled";
  doc.title("Debt payoff planner", [
    filled ? "Your cards and loans with their latest balances. Add each rate and minimum payment from your statements." : "List each debt with its balance, rate and minimum payment.",
  ]);
  doc.section("Your debts", "Pay the minimum on every debt, then put anything extra on one. Highest rate first (avalanche) costs least in interest; smallest balance first (snowball) clears debts soonest. Number them in Order.", 100);
  const counted = s.debts.filter((d) => d.currency === s.currency && d.balanceCents !== null);
  doc.table({
    columns: [
      { label: "Debt", weight: 4 },
      { label: "Balance", weight: 2.2, align: "right" },
      { label: "As of", weight: 2.2 },
      { label: "Rate %", weight: 1.4, align: "right" },
      { label: "Minimum", weight: 1.8, align: "right" },
      { label: "Extra", weight: 1.8, align: "right" },
      { label: "Order", weight: 1.2, align: "center" },
    ],
    rows: [
      ...s.debts.map((d): Cell[] => [
        d.name,
        d.balanceCents === null ? "" : moneyFormatter(d.currency)(d.balanceCents),
        { text: d.asOf ? printDate(d.asOf) : "", color: INK.muted },
        "",
        "",
        "",
        "",
      ]),
      ...blank(EXTRA_BLANK_ROWS, 7),
    ],
    totals: filled && counted.length ? ["Total owed", fmt(counted.reduce((t, d) => t + (d.balanceCents ?? 0), 0)), "", "", "", "", ""] : undefined,
    rowHeight: WRITE_ROW,
    grid: true,
  });
  if (filled && s.debts.length === 0) {
    doc.paragraph("No card or loan accounts with a balance yet, so the rows are blank.", { size: 9.5, color: INK.muted });
  }

  doc.section("Payment log", "One line per payment. Watch the balance column fall.", 120);
  const months = Array.from({ length: 12 }, (_, i) => shiftYm(s.startYm, i));
  doc.table({
    columns: [
      { label: "Month", weight: 2 },
      { label: "Debt", weight: 4 },
      { label: "Paid", weight: 2, align: "right" },
      { label: "Interest charged", weight: 2.2, align: "right" },
      { label: "New balance", weight: 2.2, align: "right" },
    ],
    rows: (filled ? months.map(printMonthShort) : Array<string>(16).fill("")).map((m): Cell[] => [m, "", "", "", ""]),
    rowHeight: WRITE_ROW,
    grid: true,
  });
}

function netWorth(doc: PrintDoc, s: NetWorthSheet) {
  const filled = s.mode === "filled";
  const fmt = moneyFormatter(s.currency);
  doc.title("Net worth worksheet", [
    filled ? "Every account with its latest balance. Write today's balance beside each, then total them." : "Write each account's balance, then total them below.",
  ]);
  const columns = [
    { label: "Account", weight: 4 },
    ...(filled
      ? [
          { label: "Type", weight: 2.2 },
          { label: "Last balance", weight: 2.2, align: "right" as const },
          { label: "As of", weight: 2.2 },
        ]
      : []),
    { label: "Balance today", weight: 2.4, align: "right" as const },
  ];
  const total = (rows: BalanceSheetRow[]) => rows.filter((r) => r.currency === s.currency).reduce((t, r) => t + (r.balanceCents ?? 0), 0);
  const totals = (rows: BalanceSheetRow[]): Cell[] | undefined => (filled ? ["Total", "", fmt(total(rows)), "", ""] : undefined);

  doc.section("What you own", undefined, 80);
  doc.table({ columns, rows: balanceRows(s.assets, filled, EXTRA_BLANK_ROWS), totals: totals(s.assets), rowHeight: WRITE_ROW, grid: true });
  doc.section("What you owe", undefined, 80);
  doc.table({ columns, rows: balanceRows(s.liabilities, filled, EXTRA_BLANK_ROWS), totals: totals(s.liabilities), rowHeight: WRITE_ROW, grid: true });
  if (filled && [...s.assets, ...s.liabilities].some((r) => r.currency !== s.currency)) {
    doc.paragraph(`Accounts in another currency are listed in their own currency and left out of the ${s.currency} totals.`, { size: 8.5, color: INK.muted });
  }
  doc.section("Net worth", undefined, 70);
  if (filled) {
    doc.paragraph(`From the last balances: ${fmt(total(s.assets))} owned less ${fmt(total(s.liabilities))} owed is ${fmt(total(s.assets) - total(s.liabilities))}.`, {
      size: 9.5,
      color: INK.muted,
    });
  }
  doc.writeLines(["Total owned", "Total owed", "Net worth", "Date"], { columns: 2 });
}
