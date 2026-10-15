import { shiftYm } from "@/lib/dashboard-period";
import { moneyFormatter, printDate, printDay, printMonth, printMonthShort, printYmd } from "./format";
import { INK, PrintDoc, type Cell } from "./pdf-doc";
import {
  BUDGET_AVERAGE_MONTHS,
  CADENCE_LABELS,
  CONTACT_ROWS,
  EXTRA_BLANK_ROWS,
  findTemplate,
  GOAL_TRACKER_MONTHS,
  INSURANCE_ROWS,
  KEPT_ROWS,
  SINKING_FUND_IDEAS,
  SPENDING_LOG_ROWS,
  type AccountsSheet,
  type BalanceSheetRow,
  type BillSheetItem,
  type BudgetSheet,
  type BillSheet,
  type DebtSheet,
  type GoalSheet,
  type NetWorthSheet,
  type PaychequeSheet,
  type SinkingFundSheet,
  type SpendingLogSheet,
  type SubscriptionSheet,
  type TemplateSheet,
} from "./templates";

/**
 * How roomy a sheet is drawn: the height of a write-in row, the largest calendar box, and how
 * many empty rows each table gets for the user's own additions.
 */
type Layout = { row: number; cell: number; extra: number };

/** Roomiest first. Handwriting wants 20pt rows; 14pt is still writable. */
const DENSITIES: ReadonlyArray<Omit<Layout, "extra">> = [
  { row: 20, cell: 78 },
  { row: 18, cell: 66 },
  { row: 16, cell: 56 },
  { row: 14, cell: 46 },
];

const blank = (count: number, width: number): Cell[][] => Array.from({ length: count }, () => Array<Cell>(width).fill(""));

/**
 * The template as a PDF. It is drawn at each density from roomiest to tightest, and the roomiest
 * that needs no more pages than the tightest wins: a sheet that would spill a few lines onto a
 * second page is tightened onto one, and one that needs three pages anyway stays roomy.
 */
export async function renderTemplatePdf(
  t: TemplateSheet,
  meta: { todayYmd: string; extraRows?: number },
): Promise<Uint8Array> {
  const extra = meta.extraRows ?? EXTRA_BLANK_ROWS;
  const attempts: Array<{ pages: number; bytes: Uint8Array }> = [];
  for (const density of DENSITIES) {
    attempts.push(await renderAt(t, meta.todayYmd, { ...density, extra }));
  }
  const fewest = Math.min(...attempts.map((a) => a.pages));
  return attempts.find((a) => a.pages === fewest)!.bytes;
}

async function renderAt(t: TemplateSheet, todayYmd: string, l: Layout): Promise<{ pages: number; bytes: Uint8Array }> {
  const info = findTemplate(t.id)!;
  const filled = t.sheet.mode === "filled";
  const doc = await PrintDoc.create({
    title: info.title,
    footer: filled
      ? `${info.title}, filled in from your data on ${printYmd(todayYmd)}. Amounts in ${t.sheet.currency}.`
      : `${info.title}. Amounts in ${t.sheet.currency}.`,
  });
  switch (t.id) {
    case "budget":
      budget(doc, t.sheet, l);
      break;
    case "bills":
      bills(doc, t.sheet, l);
      break;
    case "goals":
      goals(doc, t.sheet, l);
      break;
    case "debt":
      debt(doc, t.sheet, l);
      break;
    case "net-worth":
      netWorth(doc, t.sheet, l);
      break;
    case "subscriptions":
      subscriptions(doc, t.sheet, l);
      break;
    case "sinking-funds":
      sinkingFunds(doc, t.sheet, l);
      break;
    case "paycheque":
      paycheque(doc, t.sheet, l);
      break;
    case "spending-log":
      spendingLog(doc, t.sheet, l);
      break;
    case "accounts":
      accounts(doc, t.sheet, l);
      break;
  }
  return { pages: doc.pageCount, bytes: await doc.finish() };
}

function budget(doc: PrintDoc, s: BudgetSheet, l: Layout) {
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
    ...blank(l.extra, filled ? 7 : 4),
  ];
  const sum = (list: BudgetSheet["income"], key: "plannedCents" | "lastMonthCents" | "averageCents") =>
    list.reduce((total, r) => total + (r[key] ?? 0), 0);
  const totals = (list: BudgetSheet["income"]): Cell[] =>
    filled
      ? ["Total", fmt(sum(list, "plannedCents")), fmt(sum(list, "lastMonthCents")), fmt(sum(list, "averageCents")), "", "", ""]
      : ["Total", "", "", ""];

  doc.section("Income", filled ? "Expected is what your recurring income entries put in this month." : undefined, 80);
  doc.table({ columns: columns("Source", "Expected"), rows: rows(s.income), totals: totals(s.income), rowHeight: l.row, grid: true });

  doc.section("Spending", undefined, 80);
  doc.table({ columns: columns("Category", "Budget"), rows: rows(s.expenses), totals: totals(s.expenses), rowHeight: l.row, grid: true });
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

function bills(doc: PrintDoc, s: BillSheet, l: Layout) {
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
  doc.calendar(s.ym, byDay, l.cell);

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
      ...Array.from({ length: filled ? l.extra : l.extra + 10 }, (): Cell[] => ["", "", "", "", "", { text: "", checkbox: true }]),
    ],
    totals: filled && bills.length ? ["", `${bills.length} bill${bills.length === 1 ? "" : "s"}`, "", fmt(bills.reduce((t, b) => t + b.amountCents, 0)), "", ""] : undefined,
    rowHeight: l.row,
    grid: true,
  });
}

function goals(doc: PrintDoc, s: GoalSheet, l: Layout) {
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
      rowHeight: l.row - 2,
      grid: true,
    });

  if (!filled || s.goals.length === 0) {
    if (filled) doc.paragraph("You have no savings goals in progress, so this is a blank tracker. Add goals under Settings, Savings goals.", { size: 9.5, color: INK.muted });
    for (let i = 0; i < 2; i++) {
      doc.section("Goal", undefined, 110 + 13 * (l.row - 2));
      doc.writeLines(["Saving for", "Target amount", "By (date)", "Saved so far", "Still to go", "Needed each month"], { columns: 2 });
      grid("", "", false);
    }
    return;
  }

  s.goals.forEach((g) => {
    const fmt = moneyFormatter(g.currency);
    doc.section(g.name, g.accountName ? `Follows the balance of ${g.accountName}.` : undefined, 90 + 13 * (l.row - 2));
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

function debt(doc: PrintDoc, s: DebtSheet, l: Layout) {
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
      ...blank(l.extra, 7),
    ],
    totals: filled && counted.length ? ["Total owed", fmt(counted.reduce((t, d) => t + (d.balanceCents ?? 0), 0)), "", "", "", "", ""] : undefined,
    rowHeight: l.row,
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
    rows: (filled ? months.map(printMonthShort) : Array<string>(12 + l.extra).fill("")).map((m): Cell[] => [m, "", "", "", ""]),
    rowHeight: l.row,
    grid: true,
  });
}

function netWorth(doc: PrintDoc, s: NetWorthSheet, l: Layout) {
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
  doc.table({ columns, rows: balanceRows(s.assets, filled, l.extra), totals: totals(s.assets), rowHeight: l.row, grid: true });
  doc.section("What you owe", undefined, 80);
  doc.table({ columns, rows: balanceRows(s.liabilities, filled, l.extra), totals: totals(s.liabilities), rowHeight: l.row, grid: true });
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

function subscriptions(doc: PrintDoc, s: SubscriptionSheet, l: Layout) {
  const fmt = moneyFormatter(s.currency);
  const filled = s.mode === "filled";
  doc.title("Subscription and bill audit", [
    filled
      ? "Every recurring bill, dearest over a year first. Tick what to do with each, then total what you would save."
      : "Go through a bank or card statement and list everything that repeats. Then decide on each.",
  ]);
  doc.section(
    "Recurring bills",
    filled
      ? "From your recurring entries. Look for subscriptions with no recurring entry too: a statement lists them all."
      : "Look for streaming, music, apps and cloud storage, phone and internet, gym, news, delivery memberships and insurance.",
    100,
  );
  const box = { text: "", checkbox: true };
  doc.table({
    columns: [
      { label: "Bill", weight: 4 },
      { label: "How often", weight: 2.2 },
      { label: "Amount", weight: 2, align: "right" },
      { label: "A year", weight: 2, align: "right" },
      { label: "Next", weight: 1.8 },
      { label: "Keep", weight: 1.1, align: "center" },
      { label: "Cancel", weight: 1.2, align: "center" },
      { label: "Cheaper", weight: 1.3, align: "center" },
    ],
    rows: [
      ...s.rows.map((r): Cell[] => [
        r.name,
        { text: CADENCE_LABELS[r.cadence], color: INK.muted },
        fmt(r.amountCents),
        fmt(r.yearlyCents),
        { text: r.next ? printMonthShort(r.next.toISOString().slice(0, 7)) : "", color: INK.muted },
        box,
        box,
        box,
      ]),
      ...Array.from({ length: filled ? l.extra : l.extra + 12 }, (): Cell[] => ["", "", "", "", "", box, box, box]),
    ],
    totals:
      filled && s.rows.length
        ? ["Total", "", { text: `${fmt(Math.round(s.rows.reduce((t, r) => t + r.yearlyCents, 0) / 12))}/mo` }, fmt(s.rows.reduce((t, r) => t + r.yearlyCents, 0)), "", "", "", ""]
        : undefined,
    rowHeight: l.row,
    grid: true,
  });
  if (filled && !s.rows.length) doc.paragraph("No recurring bills yet, so the rows are blank. Add them on the dashboard's Recurring card.", { size: 9.5, color: INK.muted });
  doc.section("What you would save", undefined, 60);
  doc.writeLines(["Cancelled a month", "Cancelled a year", "Switched or renegotiated", "Total saved a year"], { columns: 2 });
}

function sinkingFunds(doc: PrintDoc, s: SinkingFundSheet, l: Layout) {
  const fmt = moneyFormatter(s.currency);
  const filled = s.mode === "filled";
  doc.title("Sinking funds planner", [
    "A sinking fund is money set aside a little each month for a cost you know is coming, so it never lands all at once.",
  ]);
  doc.section(
    "Funds",
    filled
      ? "Your quarterly and yearly bills first, with what to set aside each month to have the whole amount by its due date; then the usual irregular costs to price yourself."
      : "List each cost, when it is due and how much. Divide the amount by the months until then: that is the monthly set-aside.",
    100,
  );
  const perMonth = s.funds.reduce((t, f) => t + (f.perMonthCents ?? 0), 0);
  doc.table({
    columns: [
      { label: "Fund", weight: 4 },
      { label: "Amount", weight: 2, align: "right" },
      { label: "Due", weight: 2 },
      { label: "Months", weight: 1.3, align: "right" },
      { label: "A month", weight: 2, align: "right" },
      { label: "Saved so far", weight: 2.2, align: "right" },
    ],
    rows: [
      ...s.funds.map((f): Cell[] => [
        f.name,
        f.amountCents === null ? "" : fmt(f.amountCents),
        { text: f.due ? printDate(f.due) : "", color: INK.muted },
        { text: f.monthsToSave === null ? "" : String(f.monthsToSave), color: INK.muted },
        f.perMonthCents === null ? "" : { text: fmt(f.perMonthCents), bold: true },
        "",
      ]),
      ...SINKING_FUND_IDEAS.map((name): Cell[] => [{ text: name, color: INK.muted }, "", "", "", "", ""]),
      ...blank(l.extra, 6),
    ],
    totals: filled && s.funds.length ? ["Set aside each month", "", "", "", fmt(perMonth), ""] : undefined,
    rowHeight: l.row,
    grid: true,
  });
  doc.section("Monthly log", "What went in, what came out to pay a bill, and the balance across all funds.", 120);
  const months = Array.from({ length: 12 }, (_, i) => shiftYm(s.startYm, i));
  doc.table({
    columns: [
      { label: "Month", weight: 2 },
      { label: "Set aside", weight: 2, align: "right" },
      { label: "Spent from funds", weight: 2.4, align: "right" },
      { label: "On what", weight: 4 },
      { label: "Balance", weight: 2, align: "right" },
    ],
    rows: (filled ? months.map(printMonthShort) : Array<string>(12).fill("")).map((m): Cell[] => [m, filled && perMonth ? { text: fmt(perMonth), color: INK.faint } : "", "", "", ""]),
    rowHeight: l.row - 2,
    grid: true,
  });
}

function paycheque(doc: PrintDoc, s: PaychequeSheet, l: Layout) {
  const fmt = moneyFormatter(s.currency);
  const filled = s.mode === "filled";
  doc.title("Paycheque planner", [
    printMonth(s.ym),
    filled
      ? "Each pay with the bills due before the next one. What is left is yours to split between saving and spending."
      : "One block per pay: list the bills due before the next pay, then split what is left.",
  ]);
  const columns = [
    { label: "Due", weight: 2.2 },
    { label: "Bill", weight: 4 },
    { label: "Account", weight: 3 },
    { label: "Amount", weight: 2, align: "right" as const },
    { label: "Paid", weight: 1, align: "center" as const },
  ];
  const billRows = (bills: BillSheetItem[], extra: number): Cell[][] => [
    ...bills.map((b): Cell[] => [printDay(b.date), b.name, { text: b.accountName, color: INK.muted }, fmt(b.amountCents), { text: "", checkbox: true, checked: b.paidOn !== null }]),
    ...Array.from({ length: extra }, (): Cell[] => ["", "", "", "", { text: "", checkbox: true }]),
  ];
  const split = () => doc.writeLines(["To savings", "To debt", "Spending money", "Left over"], { columns: 4 });

  if (!filled || s.pays.length === 0) {
    if (filled) doc.paragraph("No recurring income in this month, so the blocks are blank. Add your pay as recurring income to fill them in.", { size: 9.5, color: INK.muted });
    for (let i = 0; i < 3; i++) {
      doc.section(`Pay ${i + 1}`, undefined, 60 + 6 * l.row);
      doc.writeLines(["Pay date", "Amount", "Bills total", "Left after bills"], { columns: 4 });
      doc.table({ columns, rows: billRows([], Math.max(4, l.extra)), rowHeight: l.row, grid: true });
    }
    return;
  }

  if (s.beforeFirst.length) {
    const total = s.beforeFirst.reduce((t, b) => t + b.amountCents, 0);
    doc.section("Before the first pay", `Due before ${printDate(s.pays[0].date)}: last month's pay covers these, ${fmt(total)} in all.`, 40 + l.row * 2);
    doc.table({ columns, rows: billRows(s.beforeFirst, 0), rowHeight: l.row, grid: true });
  }
  s.pays.forEach((p, i) => {
    const total = p.bills.reduce((t, b) => t + b.amountCents, 0);
    const until = s.pays[i + 1] ? `until ${printDate(s.pays[i + 1].date)}` : "to the end of the month";
    doc.section(`${printDay(p.date)}: ${p.name} ${fmt(p.amountCents)}`, `Bills ${until}: ${fmt(total)}. Left after them: ${fmt(p.amountCents - total)}.`, 60 + l.row * 3);
    doc.table({
      columns,
      rows: billRows(p.bills, Math.min(l.extra, 2)),
      totals: p.bills.length ? ["", "Bills", "", fmt(total), ""] : undefined,
      rowHeight: l.row,
      grid: true,
    });
    split();
  });
}

function spendingLog(doc: PrintDoc, s: SpendingLogSheet, l: Layout) {
  const fmt = moneyFormatter(s.currency);
  const filled = s.mode === "filled";
  doc.title("Spending log", [
    printMonth(s.ym),
    "Write down every purchase as you make it. At the end of each week, add it up by category.",
  ]);
  if (s.budgets.length) {
    doc.section(
      "Budgets this month",
      filled ? (s.running ? `Spent so far is as of today; write the rest in as you go.` : "The month has not started; write spending in as you go.") : undefined,
      80,
    );
    doc.table({
      columns: [
        { label: "Category", weight: 4 },
        { label: "Budget", weight: 2, align: "right" },
        { label: "Spent so far", weight: 2, align: "right" },
        { label: "Left", weight: 2, align: "right" },
        { label: "Week 1", weight: 1.6, align: "right" },
        { label: "Week 2", weight: 1.6, align: "right" },
        { label: "Week 3", weight: 1.6, align: "right" },
        { label: "Week 4+", weight: 1.6, align: "right" },
      ],
      rows: s.budgets.map((b): Cell[] => {
        const left = b.limitCents !== null && b.spentCents !== null ? b.limitCents - b.spentCents : null;
        return [
          b.name,
          b.limitCents === null ? "" : fmt(b.limitCents),
          { text: b.spentCents === null ? "" : fmt(b.spentCents), color: INK.muted },
          left === null ? "" : { text: left < 0 ? `-${fmt(-left)}` : fmt(left), color: left < 0 ? INK.negative : INK.positive },
          "",
          "",
          "",
          "",
        ];
      }),
      rowHeight: l.row,
      grid: true,
    });
  } else if (filled) {
    doc.paragraph("No budgets set for this month. Set them under Settings, Categories, or use the monthly budget worksheet.", { size: 9.5, color: INK.muted });
  }
  doc.section("Log", undefined, 120);
  doc.table({
    columns: [
      { label: "Date", weight: 1.6 },
      { label: "What", weight: 5 },
      { label: "Category", weight: 3 },
      { label: "Amount", weight: 2, align: "right" },
      { label: "Paid with", weight: 2.4 },
    ],
    rows: blank(SPENDING_LOG_ROWS + l.extra, 5),
    rowHeight: l.row,
    grid: true,
  });
}

function accounts(doc: PrintDoc, s: AccountsSheet, l: Layout) {
  const filled = s.mode === "filled";
  doc.title("Accounts and contacts", [
    "Where everything is, for you or for whoever has to step in. Keep it somewhere safe.",
  ]);
  doc.paragraph("Never write a full account number, password or PIN here: the last four digits and where to find the rest are enough.", {
    size: 8.5,
    color: INK.negative,
  });
  doc.section("Accounts", filled ? "Your accounts, with the bank for those linked to one." : undefined, 80);
  doc.table({
    columns: [
      { label: "Account", weight: 3.6 },
      { label: "Type", weight: 2.2 },
      { label: "Bank or company", weight: 3 },
      { label: "Ending in", weight: 1.6 },
      { label: "Phone or website", weight: 3.2 },
    ],
    rows: [
      ...s.accounts.map((a): Cell[] => [a.name, { text: a.typeLabel, color: INK.muted }, a.institution, a.mask, ""]),
      ...blank(l.extra, 5),
    ],
    rowHeight: l.row,
    grid: true,
  });
  doc.section("Insurance", undefined, 80);
  doc.table({
    columns: [
      { label: "Policy", weight: 3 },
      { label: "Company", weight: 3 },
      { label: "Policy number", weight: 2.6 },
      { label: "Phone", weight: 2.4 },
      { label: "Renews", weight: 1.8 },
    ],
    rows: INSURANCE_ROWS.map((name): Cell[] => [{ text: name, color: INK.muted }, "", "", "", ""]),
    rowHeight: l.row,
    grid: true,
  });
  doc.section("People to call", undefined, 80);
  doc.table({
    columns: [
      { label: "Who", weight: 3.2 },
      { label: "Name", weight: 3.4 },
      { label: "Phone", weight: 2.6 },
      { label: "Email", weight: 3.6 },
    ],
    rows: CONTACT_ROWS.map((name): Cell[] => [{ text: name, color: INK.muted }, "", "", ""]),
    rowHeight: l.row,
    grid: true,
  });
  doc.section("Where papers are kept", undefined, 70);
  doc.writeLines(KEPT_ROWS, { columns: 2 });
}
