import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { AccountType, CategoryKind, TransactionType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { SAVINGS_SLICE_COLOR } from "../../src/lib/category-colors";
import { TRANSFER_CATEGORY_NAME } from "../../src/lib/transfer-type";
import { expectDashboardHome } from "./expect-dashboard-home";
import { hashTestPassword, signInWithPassword, uniqueStamp } from "./helpers";

const SCREENSHOT_DIR = process.env.E2E_SCREENSHOT_DIR;

/** The 1st of this month, as a stored date-only value: inside the dashboard's default period. */
function firstOfThisMonth() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

test("the Spending by category pie shows net savings as a slice when its setting is on", async ({ page }, testInfo) => {
  const email = `e2e-pie-savings-${uniqueStamp()}@example.com`;
  const password = "e2e-password-123";
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword(password),
      displayName: "E2E Pie Savings User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  const [chequing, groceries, dining] = await Promise.all([
    prisma.account.findFirstOrThrow({ where: { userId: user.id, type: AccountType.CHEQUING } }),
    prisma.category.findFirstOrThrow({ where: { userId: user.id, kind: CategoryKind.EXPENSE, name: "Groceries" } }),
    prisma.category.findFirstOrThrow({ where: { userId: user.id, kind: CategoryKind.EXPENSE, name: { not: "Groceries" } } }),
  ]);
  const savings = await prisma.account.create({
    data: { userId: user.id, name: "High-interest savings", type: AccountType.SAVINGS, countsAsSavings: true },
  });
  const transfers = await prisma.category.create({
    data: { userId: user.id, name: TRANSFER_CATEGORY_NAME, kind: CategoryKind.TRANSFER },
  });
  const base = { userId: user.id, date: firstOfThisMonth() };
  await prisma.transaction.createMany({
    data: [
      { ...base, accountId: chequing.id, categoryId: groceries.id, type: TransactionType.EXPENSE, amountCents: 60_000, title: "Loblaws" },
      { ...base, accountId: chequing.id, categoryId: dining.id, type: TransactionType.EXPENSE, amountCents: 25_000, title: "Pizza" },
      // $700 in, $200 back out: $500 net saved.
      { ...base, accountId: chequing.id, transferAccountId: savings.id, categoryId: transfers.id, type: TransactionType.TRANSFER, amountCents: 70_000, title: "To savings" },
      { ...base, accountId: savings.id, transferAccountId: chequing.id, categoryId: transfers.id, type: TransactionType.TRANSFER, amountCents: 20_000, title: "From savings" },
    ],
  });

  await signInWithPassword(page, email, password);
  await expectDashboardHome(page);

  const pieCard = page.getByRole("region", { name: "Spending by category" });
  const legend = pieCard.locator(".recharts-legend-item");
  // Off by default: transfers stay out of the chart.
  await expect(legend).toHaveCount(2);
  await expect(legend.filter({ hasText: "Savings" })).toHaveCount(0);

  await pieCard.getByRole("button", { name: "Spending by category settings" }).click();
  const popover = page.getByRole("dialog", { name: "Spending by category settings" });
  // The page moving under it (cards streaming in, or the user scrolling) leaves it open.
  await page.evaluate(() => window.scrollBy(0, 40));
  await expect(popover).toBeVisible();
  await popover.getByRole("checkbox", { name: /Show savings/ }).check();

  // Saved is the last thing the setting writes; reload only once the row says so.
  await expect
    .poll(
      async () => {
        const row = await prisma.dashboardLayout.findUnique({ where: { userId: user.id } });
        if (!row) return null;
        return (JSON.parse(row.layoutJson) as { settings?: { "spending-by-category"?: { showSavings?: boolean } } })
          .settings?.["spending-by-category"]?.showSavings ?? null;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  await page.reload();
  await expectDashboardHome(page);

  await expect(legend).toHaveCount(3);
  const savingsItem = legend.filter({ hasText: "Savings" });
  await expect(savingsItem).toHaveCount(1);
  await expect(savingsItem.locator(`svg [fill="${SAVINGS_SLICE_COLOR}"]`).first()).toBeAttached();
  await expect(pieCard.getByTestId("savings-slice-note")).toContainText("$500.00");
  if (SCREENSHOT_DIR) {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await pieCard.scrollIntoViewIfNeeded();
    await pieCard.screenshot({ path: `${SCREENSHOT_DIR}/pie-${testInfo.project.name}.png` });
  }

  // Reports' Saved figure is untouched by the chart setting.
  await page.goto("/reports");
  await expect(page.getByTestId("report-totals")).toContainText("$500.00");
});
