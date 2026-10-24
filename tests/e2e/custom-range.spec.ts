import { expect, test } from "@playwright/test";
import { CategoryKind, TransactionType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { expectDashboardHome } from "./expect-dashboard-home";
import { hashTestPassword, signInWithPassword, uniqueStamp } from "./helpers";

/** `YYYY-MM-DD` for the given day of the month `monthsBack` before this one. */
function ymdMonthsAgo(monthsBack: number, day: number) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, day)).toISOString().slice(0, 10);
}

test("a custom date range narrows the dashboard and Reports to the days picked", async ({ page }) => {
  const stamp = uniqueStamp().replace(/[^a-z0-9]/gi, "");
  const email = `e2e-range-${stamp}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword("e2e-password-123"),
      displayName: "E2E Range User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  const account = await prisma.account.findFirstOrThrow({ where: { userId: user.id } });
  const category = await prisma.category.findFirstOrThrow({ where: { userId: user.id, kind: CategoryKind.EXPENSE } });
  const from = ymdMonthsAgo(2, 5);
  const to = ymdMonthsAgo(2, 12);
  const row = (title: string, ymd: string, amountCents: number) => ({
    userId: user.id,
    accountId: account.id,
    categoryId: category.id,
    type: TransactionType.EXPENSE,
    amountCents,
    title,
    date: new Date(`${ymd}T00:00:00Z`),
  });
  await prisma.transaction.createMany({
    data: [
      row(`Inside ${stamp}`, ymdMonthsAgo(2, 8), 4_200),
      row(`Before ${stamp}`, ymdMonthsAgo(2, 4), 1_000),
      row(`After ${stamp}`, ymdMonthsAgo(2, 13), 1_000),
    ],
  });
  await signInWithPassword(page, email, "e2e-password-123");
  await expectDashboardHome(page);

  await page.getByRole("button", { name: "Custom" }).click();
  const form = page.getByRole("form", { name: "Custom range" });
  await form.getByLabel("From").fill(from);
  await form.getByLabel("To").fill(to);
  await form.getByRole("button", { name: "Show" }).click();
  await expect(page).toHaveURL(new RegExp(`range=custom.*from=${from}.*to=${to}|from=${from}.*to=${to}.*range=custom`));
  const log = page.getByRole("region", { name: "Expense Log" });
  await expect(log).toContainText(`Inside ${stamp}`);
  await expect(log).not.toContainText(`Before ${stamp}`);
  await expect(log).not.toContainText(`After ${stamp}`);

  await page.goto("/reports");
  const reportRange = page.getByRole("form", { name: "Custom range" });
  await reportRange.getByLabel("From").fill(from);
  await reportRange.getByLabel("To").fill(to);
  await reportRange.getByRole("button", { name: "Custom range" }).click();
  // Only the $42 inside the range, not the $10 a day either side of it.
  await expect(page.getByTestId("report-totals")).toContainText("Spending$42.00");
  await expect(page.getByRole("button", { name: "Change range" })).toBeVisible();
});
