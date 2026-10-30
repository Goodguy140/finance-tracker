import { expect, test, type Page } from "@playwright/test";
import { AccountType, CategoryKind, TransactionType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { expectDashboardHome } from "./expect-dashboard-home";
import { hashTestPassword, signInWithPassword, uniqueStamp } from "./helpers";

/** The 5th of the month `monthsBack` before this one, as a stored date-only value. */
function fifthOfMonthsAgo(monthsBack: number) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 5));
}

async function seedUser(page: Page) {
  const email = `e2e-score-signals-${uniqueStamp()}@example.com`;
  const password = "e2e-password-123";
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword(password),
      displayName: "E2E Signals User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  await signInWithPassword(page, email, password);
  await expectDashboardHome(page);
  return user;
}

test("a card carrying a balance counts under Borrow; one paid off each month does not", async ({ page }) => {
  const user = await seedUser(page);
  const [chequing, card, groceries, salary] = await Promise.all([
    prisma.account.findFirstOrThrow({ where: { userId: user.id, type: AccountType.CHEQUING } }),
    prisma.account.findFirstOrThrow({ where: { userId: user.id, type: AccountType.CREDIT_CARD } }),
    prisma.category.findFirstOrThrow({ where: { userId: user.id, kind: CategoryKind.EXPENSE, name: "Groceries" } }),
    prisma.category.findFirstOrThrow({ where: { userId: user.id, kind: CategoryKind.INCOME, name: "Salary" } }),
  ]);
  await prisma.account.update({ where: { id: card.id }, data: { creditLimitCents: 1_000_000, interestRateBps: 1999 } });
  await prisma.transaction.createMany({
    data: [1, 2, 3].flatMap((m) => [
      { userId: user.id, accountId: chequing.id, categoryId: salary.id, type: TransactionType.INCOME, amountCents: 500_000, title: "Payroll", date: fifthOfMonthsAgo(m) },
      { userId: user.id, accountId: card.id, categoryId: groceries.id, type: TransactionType.EXPENSE, amountCents: 50_000, title: "Loblaws", date: fifthOfMonthsAgo(m) },
    ]),
  });
  // Paid off: the card owes only last month's charges.
  const reading = await prisma.accountBalanceSnapshot.create({
    data: { userId: user.id, accountId: card.id, date: fifthOfMonthsAgo(1), balanceCents: 50_000, source: "MANUAL" },
  });

  await page.goto("/insights");
  const score = page.getByTestId("financial-score");
  await expect(score.getByTestId("financial-score-pillars")).toContainText("No debt counted: cards are paid off and loan minimums are met");

  // Carried: $4,000 owing against the $1,000 charged in the two months before.
  await prisma.accountBalanceSnapshot.update({ where: { id: reading.id }, data: { balanceCents: 400_000 } });
  await page.reload();
  const factors = score.getByTestId("financial-score-factors");
  await expect(factors).toContainText("Credit cards");
  await expect(factors).toContainText(`$3,000.00 carried on ${card.name}, 40% of its limit`);
  await expect(page.locator('[data-testid="insight"][data-insight-key^="score:cards:"]')).toContainText("at 19.99%");
});

test("a year of birth on the profile starts the Retirement page, and categories can be marked as needs or wants", async ({ page }) => {
  const user = await seedUser(page);
  const thisYear = new Date().getUTCFullYear();

  await page.goto("/settings/profile");
  await page.getByLabel("Year of birth (optional)").fill(String(thisYear - 40));
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(async () => (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).birthYear).toBe(thisYear - 40);

  await page.goto("/reports/retirement");
  await expect(page.getByLabel("Your age")).toHaveValue("40");

  // Groceries is guessed a need; marking it a want is saved.
  await page.goto("/settings/categories");
  const row = page
    .getByRole("region", { name: "Categories & budgets" })
    .getByTestId("category-row")
    .filter({ has: page.locator("summary", { hasText: /^Groceries/ }) });
  await row.locator("summary").click();
  const role = row.getByLabel("Need or want for Groceries");
  await expect(role).toHaveValue("auto");
  await expect(role.locator("option").first()).toHaveText("Automatic (need)");
  await role.selectOption("WANT");
  await row.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(async () => (await prisma.category.findFirstOrThrow({ where: { userId: user.id, name: "Groceries", kind: CategoryKind.EXPENSE } })).spendingRole)
    .toBe("WANT");
});
