import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { hash } from "bcryptjs";
import { AccountType, CategoryKind, TransactionType } from "@prisma/client";
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

const SCREENSHOT_DIR = process.env.E2E_SCREENSHOT_DIR;

test("transfers into a savings account count as saved until it is unmarked", async ({ page }, testInfo) => {
  const email = `e2e-savings-${uniqueStamp()}@example.com`;
  const password = "e2e-password-123";
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hash(password, 12),
      displayName: "E2E Savings User",
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
  const savings = await prisma.account.create({
    data: { userId: user.id, name: "High-interest savings", type: AccountType.SAVINGS, countsAsSavings: true },
  });
  const transfers = await prisma.category.create({
    data: { userId: user.id, name: TRANSFER_CATEGORY_NAME, kind: CategoryKind.TRANSFER },
  });
  const base = { userId: user.id };
  await prisma.transaction.createMany({
    data: [1, 2].flatMap((m) => [
      { ...base, accountId: chequing.id, categoryId: salary.id, type: TransactionType.INCOME, amountCents: 300_000, title: "Acme Payroll", date: firstOfMonthsAgo(m) },
      { ...base, accountId: chequing.id, categoryId: groceries.id, type: TransactionType.EXPENSE, amountCents: 100_000, title: "Loblaws", date: firstOfMonthsAgo(m) },
    ]),
  });
  // Two months back: only the chequing leg, naming the savings account as the other side.
  await prisma.transaction.create({
    data: { ...base, accountId: chequing.id, transferAccountId: savings.id, categoryId: transfers.id, type: TransactionType.TRANSFER, amountCents: 50_000, title: "To savings", date: firstOfMonthsAgo(2) },
  });
  // Last month: both legs, paired. Counted once.
  const into = await prisma.transaction.create({
    data: { ...base, accountId: savings.id, transferAccountId: chequing.id, categoryId: transfers.id, type: TransactionType.TRANSFER, amountCents: -70_000, title: "From chequing", date: firstOfMonthsAgo(1) },
  });
  await prisma.transaction.create({
    data: { ...base, accountId: chequing.id, transferAccountId: savings.id, transferPeerId: into.id, categoryId: transfers.id, type: TransactionType.TRANSFER, amountCents: 70_000, title: "To savings", date: firstOfMonthsAgo(1) },
  });

  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Login" }).click();
  await expectDashboardHome(page);

  await page.goto("/reports");
  const totals = page.getByTestId("report-totals");
  // Income $6,000, spending $2,000, left over $4,000, of which $1,200 reached savings.
  await expect(totals).toContainText("Left over");
  await expect(totals).toContainText("$4,000.00");
  await expect(totals.getByText("Saved", { exact: true })).toBeVisible();
  await expect(totals).toContainText("$1,200.00");
  await expect(page.getByTestId("cash-flow-sankey")).toContainText("To savings");
  if (SCREENSHOT_DIR) {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.getByTestId("report-totals").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/reports-${testInfo.project.name}.png`, fullPage: true });
  }

  await page.goto("/settings/accounts");
  await page.getByRole("button", { name: "Edit High-interest savings" }).click();
  const box = page.getByRole("checkbox", { name: /Counts as savings/ });
  await expect(box).toBeChecked();
  if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/account-setting-${testInfo.project.name}.png` });
  await box.uncheck();
  await page.getByRole("button", { name: "Save account" }).click();
  await expect(box).toBeHidden();
  await expect
    .poll(async () => (await prisma.account.findUniqueOrThrow({ where: { id: savings.id } })).countsAsSavings)
    .toBe(false);

  // With nothing marked, saved goes back to income less spending.
  await page.goto("/reports");
  await expect(totals).not.toContainText("Left over");
  await expect(totals.getByText("Saved", { exact: true })).toBeVisible();
  await expect(totals).toContainText("$4,000.00");
  await expect(totals).not.toContainText("$1,200.00");
});
