import { CATEGORY_PALETTE } from "@/lib/category-colors";
import { PROJECTION_DAYS } from "@/lib/projected-balances";
import {
  GOAL_STATUS_TEXT,
  moneyFormatter,
  printChange,
  printDate,
  printDay,
  printMonth,
  printMonthShort,
  printYmd,
} from "./format";
import { INK, PrintDoc, type Cell } from "./pdf-doc";
import { SUMMARY_TOP_PAYEES, type SummaryData } from "./summary-data";

/** Categories drawn as bars; the rest are listed in the table only. */
const CATEGORY_BARS = 12;

const INCOME_COLOR = CATEGORY_PALETTE[2];
const SPENDING_COLOR = CATEGORY_PALETTE[0];
const SAVED_COLOR = CATEGORY_PALETTE[1];

/** The printable summary of everything the app knows about the user's money, as a PDF. */
export async function renderSummaryPdf(data: SummaryData): Promise<Uint8Array> {
  const fmt = moneyFormatter(data.currency);
  const signed = (cents: number) => (cents < 0 ? `-${fmt(-cents)}` : fmt(cents));
  const doc = await PrintDoc.create({
    title: `Financial summary, ${data.period.label}`,
    footer: `Financial summary for ${data.displayName}, made ${printYmd(data.todayYmd)}. Amounts in ${data.currency}.`,
  });

  const t = data.totals;
  doc.title("Financial summary", [
    `${data.displayName}  |  ${data.period.label}${data.period.toDate ? " (this month is still running)" : ""}`,
    `Made ${printYmd(data.todayYmd)}. Amounts in ${data.currency}.${data.tagName ? ` Income and spending only for entries tagged #${data.tagName}.` : ""}`,
  ]);

  // At a glance.
  const tiles = [
    { label: "Income", value: fmt(t.incomeCents) },
    { label: "Spending", value: fmt(t.spendingCents) },
    t.toSavingsCents === null
      ? { label: t.netCents >= 0 ? "Saved" : "Overspent", value: fmt(Math.abs(t.netCents)), color: t.netCents < 0 ? INK.negative : undefined }
      : { label: t.netCents >= 0 ? "Left over" : "Overspent", value: fmt(Math.abs(t.netCents)), color: t.netCents < 0 ? INK.negative : undefined },
    ...(t.toSavingsCents === null
      ? []
      : [{ label: t.toSavingsCents >= 0 ? "Saved" : "Taken from savings", value: fmt(Math.abs(t.toSavingsCents)) }]),
  ];
  const hasBalances = data.netWorth.accounts.some((a) => a.latest);
  doc.tiles([
    ...tiles,
    ...(hasBalances ? [{ label: "Net worth today", value: signed(data.netWorth.netCents) }] : []),
    {
      label: "Financial score",
      value: data.score.status === "scored" ? `${data.score.score} / 100` : "Not enough data",
      note: data.score.status === "scored" ? data.score.band : undefined,
    },
  ], 3);
  doc.paragraph(
    t.toSavingsCents === null
      ? "Income and spending only. Transfers between your accounts are left out."
      : "Transfers between your accounts are left out, except money moved into accounts that count as savings.",
    { size: 8.5, color: INK.muted },
  );
  if (data.otherCurrencyNote) {
    doc.paragraph(`Accounts in another currency are left out of these figures: ${data.otherCurrencyNote}.`, {
      size: 8.5,
      color: INK.muted,
    });
  }

  // Financial score.
  if (data.score.status === "scored") {
    const score = data.score;
    const first = score.months[0];
    const last = score.months[score.months.length - 1];
    doc.section(
      `Financial score: ${score.score} (${score.band})`,
      `Based on ${first === last ? printMonthShort(first) : `${printMonthShort(first)} to ${printMonthShort(last)}`}, whatever the period above.`,
    );
    doc.table({
      columns: [
        { label: "Factor", weight: 3 },
        { label: "Score", weight: 1, align: "right" },
        { label: "Weight", weight: 1, align: "right" },
        { label: "What was measured", weight: 6 },
      ],
      rows: score.factors.map((f) => [
        f.label,
        { text: String(Math.round(f.score)), color: f.score < 50 ? INK.negative : undefined },
        `${Math.round(f.weight * 100)}%`,
        f.detail,
      ]),
    });
    if (score.suggestions.length) {
      doc.paragraph("Where to start", { bold: true, size: 9.5 });
      doc.bullets(score.suggestions, { size: 9.5 });
    }
    if (score.omitted.length) {
      doc.paragraph(`Left out: ${score.omitted.map((o) => `${o.label} (${o.reason})`).join("; ")}.`, { size: 8.5, color: INK.muted });
    }
  } else {
    doc.section("Financial score", data.score.reason, 0);
  }

  // Income vs spending.
  doc.section("Income vs spending by month", `${data.period.label}.${data.period.toDate ? " This month is still running." : ""}`, 180);
  const showSaved = data.months.some((m) => m.toSavingsCents !== null);
  doc.columnChart(
    data.months.map((m) => ({
      label: printMonthShort(m.ym).replace(/ \d{4}$/, ""),
      values: [m.incomeCents, m.spendingCents, ...(showSaved ? [m.toSavingsCents ?? 0] : [])],
    })),
    [
      { name: "Income", color: INCOME_COLOR },
      { name: "Spending", color: SPENDING_COLOR },
      ...(showSaved ? [{ name: "To savings", color: SAVED_COLOR }] : []),
    ],
  );
  doc.table({
    columns: [
      { label: "Month", weight: 2 },
      { label: "Income", weight: 2, align: "right" },
      { label: "Spending", weight: 2, align: "right" },
      { label: "Net", weight: 2, align: "right" },
      ...(showSaved ? [{ label: "To savings", weight: 2, align: "right" as const }] : []),
    ],
    rows: data.months.map((m) => [
      printMonthShort(m.ym),
      fmt(m.incomeCents),
      fmt(m.spendingCents),
      { text: signed(m.netCents), color: m.netCents < 0 ? INK.negative : undefined },
      ...(showSaved ? [signed(m.toSavingsCents ?? 0)] : []),
    ]),
    totals: [
      "Total",
      fmt(t.incomeCents),
      fmt(t.spendingCents),
      signed(t.netCents),
      ...(showSaved ? [signed(t.toSavingsCents ?? 0)] : []),
    ],
  });

  // Spending by category.
  const current = data.categories.filter((c) => c.currentCents > 0);
  doc.section("Spending by category", `${data.period.label}, against ${data.comparisonLabel}. Split expenses count in each part's category.`);
  if (current.length) {
    doc.bars(
      current.slice(0, CATEGORY_BARS).map((c) => ({
        label: c.name,
        value: c.currentCents,
        valueText: fmt(c.currentCents),
        note: t.spendingCents > 0 ? `${Math.round((c.currentCents / t.spendingCents) * 100)}%` : undefined,
        color: c.color,
      })),
    );
  }
  doc.table({
    columns: [
      { label: "Category", weight: 4 },
      { label: "This period", weight: 2, align: "right" },
      { label: "A year earlier", weight: 2, align: "right" },
      { label: "Change", weight: 1.3, align: "right" },
    ],
    rows: data.categories.map((c) => [
      { text: c.name, swatch: c.color },
      fmt(c.currentCents),
      { text: fmt(c.previousCents), color: INK.muted },
      { text: printChange(c.changeRatio), color: c.currentCents > c.previousCents ? INK.negative : INK.positive },
    ]),
    totals: [
      "Total",
      fmt(t.spendingCents),
      fmt(data.previousSpendingCents),
      printChange(data.previousSpendingCents > 0 ? (t.spendingCents - data.previousSpendingCents) / data.previousSpendingCents : null),
    ],
    empty: "No spending in either period.",
  });

  // Budgets.
  const b = data.budgets;
  doc.section(
    `Budgets, ${printMonth(b.periodMonth)}`,
    "This month so far. A category with rollover on has what was left over (or overspent) in earlier months added to its limit.",
  );
  doc.table({
    columns: [
      { label: "Category", weight: 4 },
      { label: "Budget", weight: 2, align: "right" },
      { label: "Rollover", weight: 2, align: "right" },
      { label: "Spent", weight: 2, align: "right" },
      { label: "Left", weight: 2, align: "right" },
      { label: "Used", weight: 1.2, align: "right" },
    ],
    rows: b.budgets.map((row) => {
      const left = row.limitCents - row.spentCents;
      const used = row.limitCents > 0 ? Math.round((row.spentCents / row.limitCents) * 100) : null;
      return [
        row.categoryName,
        fmt(row.baseLimitCents),
        { text: row.carryCents === 0 ? "" : signed(row.carryCents), color: row.carryCents < 0 ? INK.negative : INK.muted },
        fmt(row.spentCents),
        { text: signed(left), color: left < 0 ? INK.danger : undefined },
        { text: used === null ? "" : `${used}%`, color: used !== null && used > 100 ? INK.danger : undefined },
      ];
    }),
    totals: b.budgets.length
      ? ["Total", "", "", fmt(b.totalSpentCents), signed(b.totalLimitCents - b.totalSpentCents), b.totalLimitCents > 0 ? `${Math.round((b.totalSpentCents / b.totalLimitCents) * 100)}%` : ""]
      : undefined,
    empty: "No budgets set. Add them under Settings, Categories.",
  });

  // Net worth.
  const nw = data.netWorth;
  const withBalance = nw.accounts.filter((a) => a.latest);
  doc.section("Net worth", "What your accounts hold less what you owe, from each account's latest balance.");
  if (withBalance.length === 0) {
    doc.paragraph("No balances yet. Linked accounts record theirs with the next bank sync; enter the rest under Settings, Accounts, Balances.", {
      size: 9.5,
      color: INK.muted,
    });
  } else {
    doc.tiles([
      { label: "Assets", value: fmt(nw.assetsCents) },
      { label: "Owed", value: fmt(nw.liabilitiesCents) },
      { label: "Net worth", value: signed(nw.netCents) },
    ]);
    doc.table({
      columns: [
        { label: "Account", weight: 5 },
        { label: "Balance as of", weight: 2.4 },
        { label: "Balance", weight: 2.4, align: "right" },
      ],
      rows: withBalance.map((a) => [
        a.counted ? a.name : `${a.name} (${a.currency}, not in the total)`,
        { text: printDate(a.latest!.date), color: INK.muted },
        {
          text: a.liability ? `-${moneyFormatter(a.currency)(a.latest!.cents)}` : moneyFormatter(a.currency)(a.latest!.cents),
          color: a.liability ? INK.negative : undefined,
        },
      ]),
    });
    if (nw.points.length > 1) {
      doc.paragraph("At the end of each month", { bold: true, size: 9.5 });
      doc.table({
        columns: [
          { label: "Month", weight: 2 },
          { label: "Assets", weight: 2, align: "right" },
          { label: "Owed", weight: 2, align: "right" },
          { label: "Net worth", weight: 2, align: "right" },
        ],
        rows: nw.points.map((p) => [printMonthShort(p.ym), fmt(p.assetsCents), fmt(p.liabilitiesCents), signed(p.netCents)]),
      });
    }
  }

  // Projected balances.
  const projection = data.projection;
  if (projection.accounts.length > 0) {
    doc.section(
      "Projected balances",
      projection.includesTransfers
        ? "Latest balances with the upcoming recurring bills, income and transfers applied to the accounts they book to."
        : "Latest balances with the upcoming recurring bills and income applied to the account each one books to.",
    );
    const horizons = ["Today", ...PROJECTION_DAYS.map((d) => `In ${d} days`)];
    doc.table({
      columns: [{ label: "Account", weight: 4 }, ...horizons.map((label) => ({ label, weight: 2, align: "right" as const }))],
      rows: projection.accounts.map((a) => [
        a.name,
        ...[a.currentCents, ...a.projectedCents].map((cents) => ({
          text: a.liability && cents !== 0 ? `-${fmt(cents)}` : signed(cents),
          color: a.liability ? INK.negative : cents < 0 ? INK.danger : undefined,
        })),
      ]),
      totals: ["Net worth", ...projection.netCents.map(signed)],
    });
    for (const a of projection.accounts.filter((x) => x.belowZero)) {
      doc.paragraph(`${a.name} goes below zero on ${printDate(a.belowZero!.date)} and reaches ${signed(a.belowZero!.lowestCents)}.`, {
        size: 9,
        color: INK.danger,
      });
    }
  }

  // Upcoming bills.
  const bills = data.bills;
  doc.section(
    `Upcoming bills and income, next ${bills.days} days`,
    "From your recurring entries, starting with anything still unposted this month.",
  );
  doc.table({
    columns: [
      { label: "Date", weight: 2.2 },
      { label: "Name", weight: 4 },
      { label: "Account", weight: 3 },
      { label: "Amount", weight: 2, align: "right" },
    ],
    rows: bills.items.map((item) => [
      { text: `${printDay(item.date)}${item.overdue ? " (due)" : ""}`, color: item.overdue ? INK.negative : undefined },
      item.name,
      { text: item.accountName, color: INK.muted },
      {
        text: item.type === "INCOME" ? `+${fmt(item.amountCents)}` : fmt(item.amountCents),
        color: item.type === "INCOME" ? INK.positive : undefined,
      },
    ]),
    totals: bills.items.length
      ? ["", `Bills ${fmt(bills.expenseCents)}, income ${fmt(bills.incomeCents)}`, "Net", signed(bills.netCents)]
      : undefined,
    empty: "No recurring bills or income coming up.",
  });

  // Savings goals.
  doc.section("Savings goals");
  doc.table({
    columns: [
      { label: "Goal", weight: 4.5 },
      { label: "Target", weight: 2, align: "right" },
      { label: "Saved", weight: 2, align: "right" },
      { label: "To go", weight: 2, align: "right" },
      { label: "By", weight: 2 },
      { label: "A month", weight: 1.8, align: "right" },
      { label: "Status", weight: 2 },
    ],
    rows: data.goals.map((g) => {
      const money = moneyFormatter(g.currency);
      const p = g.progress;
      return [
        g.account ? `${g.name} (${g.account.name})` : g.name,
        money(g.targetCents),
        p.savedCents === null ? "" : money(p.savedCents),
        money(p.remainingCents),
        g.targetYmd ? printYmd(g.targetYmd) : "",
        p.monthlyNeededCents === null ? "" : money(p.monthlyNeededCents),
        {
          text: GOAL_STATUS_TEXT[p.status],
          color: p.status === "reached" ? INK.positive : p.status === "behind" || p.status === "overdue" ? INK.negative : INK.muted,
        },
      ];
    }),
    empty: "No savings goals yet. Add one under Settings, Savings goals.",
  });

  // Contribution room.
  if (data.contributionRoom.length) {
    doc.section("Contribution room", "This year's room for your registered accounts, less what has gone in.");
    doc.table({
      columns: [
        { label: "Account type", weight: 2.5 },
        { label: "Year", weight: 1.2 },
        { label: "Room", weight: 2.4, align: "right" },
        { label: "Contributed", weight: 2.4, align: "right" },
        { label: "Remaining", weight: 2.4, align: "right" },
        { label: "Source", weight: 2.2 },
      ],
      rows: data.contributionRoom.map((r) => [
        r.accountType,
        String(r.year),
        r.startingRoomCents === null ? "Not entered" : fmt(r.startingRoomCents),
        fmt(r.contributedCents),
        {
          text: r.remainingCents === null ? "" : signed(r.remainingCents),
          color: r.remainingCents !== null && r.remainingCents < 0 ? INK.danger : undefined,
        },
        {
          text: r.source === "entered" ? "Entered" : r.source === "estimated" ? `Estimated from ${r.estimatedFromYear}` : "Unknown",
          color: INK.muted,
        },
      ]),
    });
  }

  // Payees.
  const payees = data.payees;
  doc.section("Top payees", `Who you paid most, ${data.period.label.toLowerCase()}.`);
  const top = payees.slice(0, SUMMARY_TOP_PAYEES);
  const rest = payees.slice(SUMMARY_TOP_PAYEES);
  const restSpent = rest.reduce((s, p) => s + p.spentCents, 0);
  const payeeRows: Cell[][] = top.map((p) => [
    p.label,
    { text: String(p.count), color: INK.muted },
    { text: printDate(p.lastDate), color: INK.muted },
    p.spentCents !== 0 ? fmt(p.spentCents) : { text: `+${fmt(p.receivedCents)}`, color: INK.positive },
  ]);
  if (rest.length) payeeRows.push([{ text: `${rest.length} more`, color: INK.muted }, "", "", restSpent !== 0 ? fmt(restSpent) : ""]);
  doc.table({
    columns: [
      { label: "Payee", weight: 5 },
      { label: "Entries", weight: 1.2, align: "right" },
      { label: "Last", weight: 2.2 },
      { label: "Spent", weight: 2.2, align: "right" },
    ],
    rows: payeeRows,
    empty: "No payees in this period.",
  });

  return doc.finish();
}
