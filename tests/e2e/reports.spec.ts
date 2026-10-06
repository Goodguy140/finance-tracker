import { expect, test, type Page } from "@playwright/test";
import { hash } from "bcryptjs";
import { CategoryKind, TransactionType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { TRANSFER_CATEGORY_NAME } from "../../src/lib/transfer-type";
import { expectDashboardHome } from "./expect-dashboard-home";
import { uniqueStamp } from "./helpers";

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
      passwordHash: await hash(password, 12),
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

  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Login" }).click();
  await expectDashboardHome(page);
  return user.id;
}

test("reports total income and spending without transfers, and open a payee", async ({ page }, testInfo) => {
  await seedUser(page);

  // The phone header has no room for a fourth button; there the way in is through Insights.
  if (testInfo.project.name === "mobile-chromium") await page.goto("/insights");
  await page.getByRole("link", { name: "Reports", exact: true }).filter({ visible: true }).first().click();
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

  await page.getByTestId("report-merchants").getByRole("link", { name: /Loblaws/ }).click();
  await expect(page.getByTestId("merchant-name")).toHaveText("Loblaws");
  await expect(page.getByTestId("merchant-transactions").getByRole("listitem")).toHaveCount(11);
});

test("the tag filter narrows every report to tagged entries", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Same page on every viewport; the desktop project covers it");
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
