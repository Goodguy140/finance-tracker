import { expect, test, type Page } from "@playwright/test";
import { hash } from "bcryptjs";
import { CategoryKind, RecurringCadence, TransactionType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { expectDashboardHome } from "./expect-dashboard-home";
import { uniqueStamp } from "./helpers";

/** The 5th of the month `monthsBack` before this one, as a stored date-only value. */
function fifthOfMonthsAgo(monthsBack: number) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 5));
}

/**
 * Six full months of $4,000 pay and $3,000 groceries, plus $600 a month of dining in the
 * latest three against a $300 dining budget, and $2,000 rent as a recurring bill. That is a
 * fair score with three things to fix: the dining budget, the rise in spending, and rent.
 */
async function seedUser(page: Page) {
  const email = `e2e-score-${uniqueStamp()}@example.com`;
  const password = "e2e-password-123";
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hash(password, 12),
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
    prisma.account.findFirstOrThrow({ where: { userId: user.id } }),
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

  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Login" }).click();
  await expectDashboardHome(page);
}

test("the financial score shows on Insights and Reports with what to improve", async ({ page }, testInfo) => {
  await seedUser(page);

  for (const path of ["/insights", "/reports"]) {
    await page.goto(path);
    const card = page.getByTestId("financial-score");
    // Savings 84, bills 70, budgets 0, trend 17, months in the black 100, weighted 35/20/20/15/10.
    await expect(card.getByTestId("financial-score-value")).toHaveText("56");
    await expect(card.getByTestId("financial-score-band")).toHaveText("Fair");
    await expect(card.getByTestId("financial-score-factors").getByRole("listitem")).toHaveCount(5);
    const suggestions = card.getByTestId("financial-score-suggestions").getByRole("listitem");
    await expect(suggestions).toHaveCount(3);
    await expect(suggestions.nth(0)).toContainText("Dining went over budget in 3 of the last 3 months");
    await expect(suggestions.nth(1)).toContainText("The biggest rise is Dining, up $600.00 a month");
    await expect(suggestions.nth(2)).toContainText("Rent ($2,000.00/mo)");
    await card.screenshot({ path: testInfo.outputPath(`score${path.replace("/", "-")}.png`) });
  }
});
