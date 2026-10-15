import { CategoryKind } from "@prisma/client";
import { formatAccountTypeLabel } from "@/lib/account-type-labels";
import { forecastRecurringOccurrences } from "@/lib/bills-forecast";
import { buildMonthlyBudgetProgress } from "@/lib/budget-progress";
import { getCountryConfig } from "@/lib/country-config";
import { shiftYm, startOfMonthYm } from "@/lib/dashboard-period";
import { dateFromYmd, ymdFromDateUtc } from "@/lib/date-only";
import { loadNetWorth } from "@/lib/net-worth-data";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { prisma } from "@/lib/prisma";
import { loadReportTxs } from "@/lib/reports/load";
import { loadSavingsGoals } from "@/lib/savings-goals-data";
import {
  amountsByMonthAndCategory,
  BLANK_ACCOUNT_ROWS,
  BLANK_ASSET_ROWS,
  BLANK_DEBT_ROWS,
  BUDGET_AVERAGE_MONTHS,
  budgetSheetRows,
  groupByPaycheque,
  resolveTemplateMonth,
  SINKING_CADENCES,
  sinkingFund,
  subscriptionRows,
  yearlyCents,
  type BalanceSheetRow,
  type BillSheetItem,
  type BudgetSheetRow,
  type TemplateId,
  type TemplateMode,
  type TemplateSheet,
} from "./templates";

type TemplateUser = { id: string; timezone: string | null; countryCode: string | null };

const blankRow = (name: string): BudgetSheetRow => ({ name, plannedCents: null, carryCents: 0, lastMonthCents: null, averageCents: null });
const blankBalance = (name: string, currency: string): BalanceSheetRow => ({ name, typeLabel: "", currency, balanceCents: null, asOf: null });

/** Days from `todayYmd` through the last day of `ym`, for a forecast that has to reach it. */
function daysThroughEndOf(ym: string, todayYmd: string): number {
  const end = startOfMonthYm(shiftYm(ym, 1)).getTime() - 86_400_000;
  return Math.max(0, Math.round((end - dateFromYmd(todayYmd).getTime()) / 86_400_000));
}

/**
 * The data behind one template. "blank" reads nothing of the user's beyond their country's
 * currency and default category names, so a blank sheet is safe to hand to anyone.
 */
export async function loadTemplateSheet(
  user: TemplateUser,
  id: TemplateId,
  mode: TemplateMode,
  options: { month?: string | null } = {},
): Promise<TemplateSheet> {
  const todayYmd = currentYmdInTimeZone(user.timezone);
  const currentYm = todayYmd.slice(0, 7);
  const config = getCountryConfig(user.countryCode);
  const currency = config.defaultCurrency;
  const ym = resolveTemplateMonth(options.month, currentYm);
  const historyMonths = Array.from({ length: BUDGET_AVERAGE_MONTHS }, (_, i) => shiftYm(currentYm, i - BUDGET_AVERAGE_MONTHS));

  switch (id) {
    case "budget": {
      if (mode === "blank") {
        return {
          id,
          sheet: {
            mode,
            ym,
            historyMonths,
            currency,
            income: config.defaultIncomeCategories.map(blankRow),
            expenses: config.defaultExpenseCategories.map(blankRow),
          },
        };
      }
      const [categories, txs, budgets, recurring] = await Promise.all([
        prisma.category.findMany({ where: { userId: user.id }, select: { id: true, name: true, kind: true } }),
        loadReportTxs(user.id, startOfMonthYm(historyMonths[0]), currency),
        buildMonthlyBudgetProgress(user.id, ym),
        loadForecastRules(user.id, currency),
      ]);
      const amounts = amountsByMonthAndCategory(txs, historyMonths);
      const planned = new Map(budgets.budgets.map((b) => [b.categoryId, { cents: b.limitCents, carryCents: b.carryCents }]));
      // Income "planned" is what recurring income rules expect to land in the month.
      const expectedIncome = new Map<string, { cents: number; carryCents: number }>();
      for (const o of forecastRecurringOccurrences(recurring, { todayYmd, currentYm, days: daysThroughEndOf(ym, todayYmd) }).occurrences) {
        if (o.rule.type !== "INCOME" || ymdFromDateUtc(o.date).slice(0, 7) !== ym) continue;
        const prev = expectedIncome.get(o.rule.categoryId)?.cents ?? 0;
        expectedIncome.set(o.rule.categoryId, { cents: prev + o.rule.amountCents, carryCents: 0 });
      }
      return {
        id,
        sheet: {
          mode,
          ym,
          historyMonths,
          currency,
          income: budgetSheetRows(categories.filter((c) => c.kind === CategoryKind.INCOME), amounts.income, historyMonths, expectedIncome),
          expenses: budgetSheetRows(categories.filter((c) => c.kind === CategoryKind.EXPENSE), amounts.expense, historyMonths, planned),
        },
      };
    }

    case "bills": {
      if (mode === "blank") return { id, sheet: { mode, ym, currency, items: [] } };
      return { id, sheet: { mode, ym, currency, items: await loadBillItems(user.id, currency, ym, todayYmd) } };
    }

    case "paycheque": {
      if (mode === "blank") return { id, sheet: { mode, ym, currency, pays: [], beforeFirst: [] } };
      return { id, sheet: { mode, ym, currency, ...groupByPaycheque(await loadBillItems(user.id, currency, ym, todayYmd)) } };
    }

    case "subscriptions": {
      if (mode === "blank") return { id, sheet: { mode, currency, rows: [] } };
      const rules = (await loadForecastRules(user.id, currency)).filter((r) => r.type === "EXPENSE");
      const categories = new Map(
        (await prisma.category.findMany({ where: { userId: user.id }, select: { id: true, name: true } })).map((c) => [c.id, c.name]),
      );
      const next = firstOccurrences(rules, todayYmd, currentYm);
      return {
        id,
        sheet: {
          mode,
          currency,
          rows: subscriptionRows(
            rules.map((r) => ({
              name: r.name,
              categoryName: categories.get(r.categoryId) ?? "",
              accountName: r.account.name,
              cadence: r.cadence,
              amountCents: r.amountCents,
              yearlyCents: yearlyCents(r.amountCents, r.cadence),
              next: next.get(r.id) ?? null,
            })),
          ),
        },
      };
    }

    case "sinking-funds": {
      if (mode === "blank") return { id, sheet: { mode, currency, startYm: currentYm, funds: [] } };
      const rules = (await loadForecastRules(user.id, currency)).filter((r) => r.type === "EXPENSE" && SINKING_CADENCES.has(r.cadence));
      const next = firstOccurrences(rules, todayYmd, currentYm);
      return {
        id,
        sheet: {
          mode,
          currency,
          startYm: currentYm,
          funds: rules
            .flatMap((r) => {
              const due = next.get(r.id);
              return due ? [sinkingFund(r.name, r.amountCents, due, currentYm)] : [];
            })
            .sort((a, b) => a.due!.getTime() - b.due!.getTime()),
        },
      };
    }

    case "spending-log": {
      if (mode === "blank") {
        return {
          id,
          sheet: { mode, ym, currency, running: false, budgets: config.defaultExpenseCategories.map((name) => ({ name, limitCents: null, spentCents: null })) },
        };
      }
      const progress = await buildMonthlyBudgetProgress(user.id, ym);
      const running = ym === currentYm;
      return {
        id,
        sheet: {
          mode,
          ym,
          currency,
          running,
          budgets: progress.budgets
            .map((b) => ({ name: b.categoryName, limitCents: b.limitCents, spentCents: running ? b.spentCents : null }))
            .sort((a, b) => (b.limitCents ?? 0) - (a.limitCents ?? 0)),
        },
      };
    }

    case "accounts": {
      if (mode === "blank") {
        return { id, sheet: { mode, currency, accounts: BLANK_ACCOUNT_ROWS.map((name) => ({ name, typeLabel: "", institution: "", mask: "" })) } };
      }
      const accounts = await prisma.account.findMany({
        where: { userId: user.id, archived: false },
        orderBy: { createdAt: "asc" },
        select: {
          name: true,
          type: true,
          plaidAccounts: { select: { mask: true, plaidItem: { select: { institutionName: true } } }, take: 1 },
        },
      });
      return {
        id,
        sheet: {
          mode,
          currency,
          accounts: accounts.map((a) => ({
            name: a.name,
            typeLabel: formatAccountTypeLabel(a.type),
            institution: a.plaidAccounts[0]?.plaidItem.institutionName ?? "",
            mask: a.plaidAccounts[0]?.mask ?? "",
          })),
        },
      };
    }

    case "goals": {
      if (mode === "blank") return { id, sheet: { mode, currency, startYm: currentYm, goals: [] } };
      const { goals } = await loadSavingsGoals(user);
      return {
        id,
        sheet: {
          mode,
          currency,
          startYm: currentYm,
          goals: goals
            .filter((g) => g.progress.status !== "reached")
            .map((g) => ({
              name: g.name,
              currency: g.currency,
              targetCents: g.targetCents,
              savedCents: g.progress.savedCents,
              remainingCents: g.progress.remainingCents,
              targetYmd: g.targetYmd,
              monthlyNeededCents: g.progress.monthlyNeededCents,
              accountName: g.account?.name ?? null,
            })),
        },
      };
    }

    case "debt":
    case "net-worth": {
      if (mode === "blank") {
        return id === "debt"
          ? { id, sheet: { mode, currency, startYm: currentYm, debts: BLANK_DEBT_ROWS.map((n) => blankBalance(n, currency)) } }
          : {
              id,
              sheet: {
                mode,
                currency,
                assets: BLANK_ASSET_ROWS.map((n) => blankBalance(n, currency)),
                liabilities: BLANK_DEBT_ROWS.map((n) => blankBalance(n, currency)),
              },
            };
      }
      const netWorth = await loadNetWorth(user);
      const archived = new Set(
        (await prisma.account.findMany({ where: { userId: user.id, archived: true }, select: { id: true } })).map((a) => a.id),
      );
      // An archived account still shows while it has a balance: it is still owed or held.
      const rows = netWorth.accounts
        .filter((a) => !archived.has(a.accountId) || (a.latest && a.latest.cents !== 0))
        .map((a) => ({
          liability: a.liability,
          row: {
            name: a.name,
            typeLabel: formatAccountTypeLabel(a.type),
            currency: a.currency,
            balanceCents: a.latest?.cents ?? null,
            asOf: a.latest?.date ?? null,
          },
        }));
      const liabilities = rows.filter((r) => r.liability).map((r) => r.row);
      return id === "debt"
        ? { id, sheet: { mode, currency, startYm: currentYm, debts: liabilities } }
        : { id, sheet: { mode, currency, assets: rows.filter((r) => !r.liability).map((r) => r.row), liabilities } };
    }
  }
}

/**
 * The month's bills and income for the bill calendar and the paycheque planner: what is still to
 * come from the recurring rules, plus what was already posted from them this month, marked paid.
 */
async function loadBillItems(userId: string, currency: string, ym: string, todayYmd: string): Promise<BillSheetItem[]> {
  const currentYm = todayYmd.slice(0, 7);
  const [rules, posted] = await Promise.all([
    loadForecastRules(userId, currency),
    // Occurrences already posted this month have moved the rule on, so the forecast no
    // longer lists them; they come from the entries they became, marked paid.
    prisma.transaction.findMany({
      where: {
        userId,
        type: { in: ["EXPENSE", "INCOME"] },
        recurringTransactionId: { not: null },
        recurringExpectedDate: { gte: startOfMonthYm(ym), lt: startOfMonthYm(shiftYm(ym, 1)) },
        account: { currency },
      },
      select: {
        date: true,
        amountCents: true,
        type: true,
        recurringExpectedDate: true,
        recurringTransactionId: true,
        title: true,
        account: { select: { name: true } },
      },
    }),
  ]);
  const forecast = forecastRecurringOccurrences(rules, { todayYmd, currentYm, days: daysThroughEndOf(ym, todayYmd) });
  const ruleNames = new Map(rules.map((r) => [r.id, r.name]));
  return [
    ...posted.map((t) => ({
      date: t.recurringExpectedDate!,
      name: ruleNames.get(t.recurringTransactionId!) ?? t.title ?? "",
      type: t.type as "EXPENSE" | "INCOME",
      amountCents: t.amountCents,
      accountName: t.account?.name ?? "",
      paidOn: t.date,
    })),
    ...forecast.occurrences
      .filter((o) => ymdFromDateUtc(o.date).slice(0, 7) === ym)
      .map((o) => ({
        date: o.date,
        name: o.rule.name,
        type: o.rule.type as "EXPENSE" | "INCOME",
        amountCents: o.rule.amountCents,
        accountName: o.rule.account.name,
        paidOn: null,
      })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());
}

/**
 * Each rule's next occurrence still to pay, from today on (two years out, for a two-yearly bill).
 * An overdue one is left for the Recurring card; the plan is about what comes next.
 */
function firstOccurrences(rules: Awaited<ReturnType<typeof loadForecastRules>>, todayYmd: string, currentYm: string): Map<string, Date> {
  const out = new Map<string, Date>();
  for (const o of forecastRecurringOccurrences(rules, { todayYmd, currentYm, days: 731 }).occurrences) {
    if (!o.overdue && !out.has(o.rule.id)) out.set(o.rule.id, o.date);
  }
  return out;
}

/** Enabled bill and income rules on home-currency accounts, as the Upcoming bills card takes them. */
export async function loadForecastRules(userId: string, currency: string) {
  const rules = await prisma.recurringTransaction.findMany({
    where: { userId, enabled: true, type: { in: ["EXPENSE", "INCOME"] } },
    select: {
      id: true,
      name: true,
      type: true,
      amountCents: true,
      cadence: true,
      nextExpectedDate: true,
      anchorDay: true,
      endDate: true,
      enabled: true,
      categoryId: true,
      account: { select: { name: true, currency: true } },
    },
  });
  return rules.filter((rule) => rule.account.currency === currency);
}
