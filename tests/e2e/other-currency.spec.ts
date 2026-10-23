import { expect, test } from "@playwright/test";
import { AccountType, CategoryKind, TransactionType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { expectDashboardHome } from "./expect-dashboard-home";
import { hashTestPassword, signInWithPassword, uniqueStamp } from "./helpers";

/** The 15th of the month two before this one: inside the last 12 months, whatever the timezone. */
function midTwoMonthsAgo() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 15));
}

test("entries on a USD account are listed in USD and kept out of the CAD totals", async ({ page }) => {
  const email = `e2e-other-currency-${uniqueStamp()}@example.com`;
  const password = "e2e-password-123";
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword(password),
      displayName: "E2E Other Currency User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  const [chequing, groceries, salary] = await Promise.all([
    prisma.account.findFirstOrThrow({ where: { userId: user.id, type: AccountType.CHEQUING } }),
    prisma.category.findFirstOrThrow({ where: { userId: user.id, kind: CategoryKind.EXPENSE, name: "Groceries" } }),
    prisma.category.findFirstOrThrow({ where: { userId: user.id, kind: CategoryKind.INCOME } }),
  ]);
  const usd = await prisma.account.create({
    data: { userId: user.id, name: "US chequing", type: AccountType.CHEQUING, currency: "USD" },
  });
  const date = midTwoMonthsAgo();
  const row = (accountId: string, type: TransactionType, amountCents: number, title: string) => ({
    userId: user.id,
    accountId,
    categoryId: type === TransactionType.INCOME ? salary.id : groceries.id,
    type,
    amountCents,
    title,
    date,
  });
  await prisma.transaction.createMany({
    data: [
      row(chequing.id, TransactionType.EXPENSE, 2_500, "Corner store"),
      row(usd.id, TransactionType.EXPENSE, 4_000, "Seattle groceries"),
      row(chequing.id, TransactionType.INCOME, 100_000, "Acme Payroll"),
      row(usd.id, TransactionType.INCOME, 50_000, "US client"),
    ],
  });

  await signInWithPassword(page, email, password);
  await expectDashboardHome(page);

  await page.goto("/?range=lifetime");
  // Spending and income count the CAD rows only, and say what was left out.
  await expect(page.getByText("$25.00 / ", { exact: false }).first()).toBeVisible();
  await expect(page.getByTestId("budgets-other-currency").first()).toHaveText("Not included: US$40.00 in USD");
  await expect(page.getByTestId("income-other-currency").first()).toHaveText("Not included: US$500.00 in USD");
  // The USD rows are still in the logs, in their own currency.
  await expect(page.getByTestId("expense-amount").filter({ hasText: "US$40.00" }).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByTestId("income-amount").filter({ hasText: "+US$500.00" }).filter({ visible: true }).first()).toBeVisible();

  await page.goto("/reports");
  const totals = page.getByTestId("report-totals");
  await expect(totals).toContainText("$1,000.00");
  await expect(totals).toContainText("$25.00");
  await expect(totals).not.toContainText("$1,500.00");
  await expect(page.getByTestId("report-other-currency")).toContainText("income US$500.00 in USD; spending US$40.00 in USD");
});
