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
  BLANK_ASSET_ROWS,
  BLANK_DEBT_ROWS,
  BUDGET_AVERAGE_MONTHS,
  budgetSheetRows,
  resolveTemplateMonth,
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
      const [rules, posted] = await Promise.all([
        loadForecastRules(user.id, currency),
        // Occurrences already posted this month have moved the rule on, so the forecast no
        // longer lists them; they come from the entries they became, marked paid.
        prisma.transaction.findMany({
          where: {
            userId: user.id,
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
      const items: BillSheetItem[] = [
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
      return { id, sheet: { mode, ym, currency, items } };
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

/** Enabled bill and income rules on home-currency accounts, as the Upcoming bills card takes them. */
async function loadForecastRules(userId: string, currency: string) {
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
