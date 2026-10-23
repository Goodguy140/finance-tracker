import { expect, test, type Page } from "@playwright/test";
import { CategoryKind, TransactionType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { TRANSFER_CATEGORY_NAME } from "../../src/lib/transfer-type";
import { expectDashboardHome } from "./expect-dashboard-home";
import { hashTestPassword, signInWithPassword, uniqueStamp } from "./helpers";

/** The 1st of the month `monthsBack` before this one, as a stored date-only value. */
function firstOfMonthsAgo(monthsBack: number) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1));
}

/**
 * Eleven months of pay and groceries inside the trailing twelve months (the current month is
 * left out so a UTC/Toronto month boundary cannot push a row into the future), a transfer
 * that must not count, and one expense thirteen months back for the year-over-year column.
 */
async function seedUser(page: Page): Promise<string> {
  const email = `e2e-reports-${uniqueStamp()}@example.com`;
  const password = "e2e-password-123";
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword(password),
      displayName: "E2E Reports User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  const [account, groceries, fun, salary] = await Promise.all([
    prisma.account.findFirstOrThrow({ where: { userId: user.id } }),
    prisma.category.findFirstOrThrow({ where: { userId: user.id, kind: CategoryKind.EXPENSE, name: "Groceries" } }),
    prisma.category.findFirstOrThrow({ where: { userId: user.id, kind: CategoryKind.EXPENSE, name: "Fun" } }),
    prisma.category.findFirstOrThrow({ where: { userId: user.id, kind: CategoryKind.INCOME } }),
  ]);
  const transfers = await prisma.category.create({
    data: { userId: user.id, name: TRANSFER_CATEGORY_NAME, kind: CategoryKind.TRANSFER },
  });
  const months = Array.from({ length: 11 }, (_, i) => i + 1);
  await prisma.transaction.createMany({
    data: [
      ...months.map((m) => ({
        userId: user.id,
        accountId: account.id,
        categoryId: salary.id,
        type: TransactionType.INCOME,
        amountCents: 300_000,
        title: "Acme Payroll",
        date: firstOfMonthsAgo(m),
      })),
      ...months.map((m) => ({
        userId: user.id,
        accountId: account.id,
        categoryId: groceries.id,
        type: TransactionType.EXPENSE,
        amountCents: 40_000,
        title: "Loblaws",
        date: firstOfMonthsAgo(m),
      })),
      {
        userId: user.id,
        accountId: account.id,
        categoryId: transfers.id,
        type: TransactionType.TRANSFER,
        amountCents: 100_000,
        title: "Card payment",
        date: firstOfMonthsAgo(1),
      },
      {
        userId: user.id,
        accountId: account.id,
        categoryId: fun.id,
        type: TransactionType.EXPENSE,
        amountCents: 5_000,
        title: "Cinema",
        date: firstOfMonthsAgo(13),
      },
    ],
  });

  await signInWithPassword(page, email, password);
  await expectDashboardHome(page);
  return user.id;
}

test("reports total income and spending without transfers, and open a payee", async ({ page }) => {
  await seedUser(page);

  // The top bar on desktop, the tab bar on phones. Checked by href and then visited, not
  // clicked: the dashboard refreshes itself after load, and a client navigation started in
  // that window can be dropped.
  await expect(page.getByRole("link", { name: "Reports", exact: true }).filter({ visible: true }).first()).toHaveAttribute(
    "href",
    "/reports",
  );
  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "Reports", level: 1 })).toBeVisible();

  const totals = page.getByTestId("report-totals");
  await expect(totals).toContainText("$33,000.00");
  // 11 × $400 of groceries; the $1,000 transfer is not spending.
  await expect(totals).toContainText("$4,400.00");
  await expect(totals).toContainText("$28,600.00");

  await expect(page.getByTestId("cash-flow-sankey")).toContainText("Saved");
  await expect(page.getByTestId("cash-flow-sankey")).not.toContainText(TRANSFER_CATEGORY_NAME);

  const yoy = page.getByTestId("report-yoy");
  await expect(yoy.getByRole("row", { name: /Groceries/ })).toContainText("$4,400.00");
  await expect(yoy.getByRole("row", { name: /Fun/ })).toContainText("$50.00");
  await expect(yoy.getByRole("row", { name: /Fun/ })).toContainText("-100%");

  // Pay is listed under who paid you, not among the payees.
  await expect(page.getByTestId("report-payers").getByRole("link", { name: /Acme Payroll/ })).toBeVisible();
  await expect(page.getByTestId("report-merchants").getByRole("link", { name: /Acme Payroll/ })).toHaveCount(0);

  await page.getByTestId("report-merchants").getByRole("link", { name: /Loblaws/ }).click();
  await expect(page.getByTestId("merchant-name")).toHaveText("Loblaws");
  await expect(page.getByTestId("merchant-transactions").getByRole("listitem")).toHaveCount(11);
});

test("the tag filter narrows every report to tagged entries", async ({ page }) => {
  const userId = await seedUser(page);
  const groceries = await prisma.transaction.findFirstOrThrow({ where: { userId, title: "Loblaws" } });
  const tag = await prisma.tag.create({ data: { userId, name: "Party", nameKey: "party" } });
  await prisma.transactionTag.create({ data: { transactionId: groceries.id, tagId: tag.id } });

  await page.goto("/reports");
  await page.getByTestId("tag-filter").selectOption(tag.id);
  await expect(page.getByTestId("report-tag-note")).toContainText("#Party");
  const totals = page.getByTestId("report-totals");
  await expect(totals).toContainText("$0.00");
  await expect(totals).toContainText("$400.00");
  await expect(page.getByTestId("report-merchants").getByRole("listitem")).toHaveCount(1);
});

test("with under a year of history, year over year says so instead of a column of zeros", async ({ page }) => {
  const userId = await seedUser(page);
  // Drop the one expense from over a year ago: now nothing comes before this period.
  await prisma.transaction.deleteMany({ where: { userId, title: "Cinema" } });

  await page.goto("/reports");
  await expect(page.getByTestId("report-yoy-empty")).toContainText("Nothing to compare yet");
  await expect(page.getByTestId("report-yoy")).toHaveCount(0);
});

test("an unknown payee opens the app's own not-found page", async ({ page }) => {
  await seedUser(page);
  await page.goto("/reports/merchant?key=nobody-at-all");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to the dashboard" })).toHaveAttribute("href", "/");
});
