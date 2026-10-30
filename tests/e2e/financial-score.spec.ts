import { expect, test, type Page } from "@playwright/test";
import { AccountType, CategoryKind, RecurringCadence, TransactionType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { expectDashboardHome } from "./expect-dashboard-home";
import { hashTestPassword, signInWithPassword, uniqueStamp } from "./helpers";

/** The 5th of the month `monthsBack` before this one, as a stored date-only value. */
function fifthOfMonthsAgo(monthsBack: number) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 5));
}

/**
 * Six full months of $4,000 pay and $3,000 groceries, plus $600 a month of dining in the
 * latest three against a $300 dining budget, $2,000 rent as a recurring bill, and $3,300 in
 * chequing (one month of the $3,300 average spending). That is a fair score with three things
 * to fix: the dining budget, the rise in spending, and the emergency fund.
 */
async function seedUser(page: Page) {
  const email = `e2e-score-${uniqueStamp()}@example.com`;
  const password = "e2e-password-123";
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword(password),
      displayName: "E2E Score User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  const category = (name: string, kind: CategoryKind = CategoryKind.EXPENSE) =>
    prisma.category.findFirstOrThrow({ where: { userId: user.id, kind, name } });
  const [account, groceries, dining, rent, salary] = await Promise.all([
    prisma.account.findFirstOrThrow({ where: { userId: user.id, type: AccountType.CHEQUING } }),
    category("Groceries"),
    category("Dining"),
    category("Rent"),
    category("Salary", CategoryKind.INCOME),
  ]);
  const months = [1, 2, 3, 4, 5, 6];
  const row = (categoryId: string, type: TransactionType, amountCents: number, title: string, monthsBack: number) => ({
    userId: user.id,
    accountId: account.id,
    categoryId,
    type,
    amountCents,
    title,
    date: fifthOfMonthsAgo(monthsBack),
  });
  await prisma.transaction.createMany({
    data: [
      ...months.map((m) => row(salary.id, TransactionType.INCOME, 400_000, "Acme Payroll", m)),
      ...months.map((m) => row(groceries.id, TransactionType.EXPENSE, 300_000, "Loblaws", m)),
      ...[1, 2, 3].map((m) => row(dining.id, TransactionType.EXPENSE, 60_000, "Bistro", m)),
    ],
  });
  await prisma.accountBalanceSnapshot.create({
    data: { userId: user.id, accountId: account.id, date: fifthOfMonthsAgo(1), balanceCents: 330_000, source: "MANUAL" },
  });
  await prisma.budget.create({ data: { userId: user.id, categoryId: dining.id, periodMonth: "2020-01", limitCents: 30_000 } });
  await prisma.recurringTransaction.create({
    data: {
      userId: user.id,
      accountId: account.id,
      categoryId: rent.id,
      type: TransactionType.EXPENSE,
      name: "Rent",
      amountCents: 200_000,
      cadence: RecurringCadence.MONTHLY,
      nextExpectedDate: fifthOfMonthsAgo(-1),
    },
  });

  await signInWithPassword(page, email, password);
  await expectDashboardHome(page);
}

test("the financial score shows on Insights, with a one-line summary on Reports", async ({ page }, testInfo) => {
  await seedUser(page);
  const suggested = [
    "Dining went over budget in 3 of the last 3 months",
    "The biggest rise is Dining, up $600.00 a month",
    "Chequing and savings cover 1.0 month of spending. Setting aside about $6,600.00 would build a 3-month emergency fund.",
  ];

  await page.goto("/insights");
  const card = page.getByTestId("financial-score");
  // Savings 83.75, emergency fund 40, bills 70, budgets 0, trend 16.7, and a cash buffer of 72 (chequing
  // got down to about 23 days of spending, walked back from its balance), weighted 25/15/15/10/10/10.
  await expect(card.getByTestId("financial-score-value")).toHaveText("54");
  await expect(card.getByTestId("financial-score-band")).toHaveText("Fair");
  await expect(card.getByTestId("financial-score-factors").getByRole("listitem")).toHaveCount(6);
  await expect(card.getByTestId("financial-score-factors")).toContainText("Everyday accounts got down to about 23 days of spending");
  // Nothing owed and nothing to plan with: those pillars say why they have no score.
  const pillars = card.getByTestId("financial-score-pillars");
  await expect(pillars.getByRole("listitem")).toHaveCount(4);
  await expect(pillars).toContainText("No debt counted");
  await card.screenshot({ path: testInfo.outputPath("score-insights.png") });

  // Reports shows the same score in one line, linking to the full card on Insights.
  await page.goto("/reports");
  const chip = page.getByTestId("financial-score-chip");
  await expect(chip.getByTestId("financial-score-value")).toHaveText("54");
  await expect(chip.getByTestId("financial-score-band")).toHaveText("Fair");
  await expect(page.getByTestId("financial-score")).toHaveCount(0);
  await expect(chip.getByRole("link", { name: /How it.s worked out/ })).toHaveAttribute("href", "/insights");

  // Insights lists them once, as insights that can be dismissed like the rest.
  await page.goto("/insights");
  await expect(page.getByTestId("financial-score-suggestions")).toHaveCount(0);
  const fromScore = page.locator('[data-testid="insight"][data-insight-key^="score:"]');
  await expect(fromScore).toHaveCount(3);
  for (const [factor, text] of [["budgets", suggested[0]], ["trend", suggested[1]], ["emergency", suggested[2]]]) {
    await expect(page.locator(`[data-testid="insight"][data-insight-key^="score:${factor}:"]`)).toContainText(text);
  }
});
