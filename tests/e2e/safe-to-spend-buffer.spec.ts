import { expect, test } from "@playwright/test";
import { CategoryKind, RecurringCadence, TransactionType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { currentYmInTimeZone } from "../../src/lib/period-month";
import { expectDashboardHome } from "./expect-dashboard-home";
import { hashTestPassword, signInWithPassword, uniqueStamp } from "./helpers";

test("the bill buffer holds back next month's bills in Safe to spend", async ({ page }) => {
  const stamp = uniqueStamp().replace(/[^a-z0-9]/gi, "");
  const email = `e2e-buffer-${stamp}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword("e2e-password-123"),
      displayName: "E2E Buffer User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  const account = await prisma.account.findFirstOrThrow({ where: { userId: user.id } });
  const expense = await prisma.category.findFirstOrThrow({ where: { userId: user.id, kind: CategoryKind.EXPENSE } });
  const incomeCategory = await prisma.category.findFirstOrThrow({ where: { userId: user.id, kind: CategoryKind.INCOME } });
  const ym = currentYmInTimeZone(user.timezone);
  await prisma.transaction.create({
    data: {
      userId: user.id,
      accountId: account.id,
      categoryId: incomeCategory.id,
      type: TransactionType.INCOME,
      amountCents: 100_000,
      title: "Pay",
      date: new Date(`${ym}-01T00:00:00Z`),
    },
  });
  // One bill on the 3rd of next month: inside a 60-day buffer whatever today is.
  const [y, m] = ym.split("-").map(Number);
  const nextMonthThird = new Date(Date.UTC(y, m, 3));
  await prisma.recurringTransaction.create({
    data: {
      userId: user.id,
      accountId: account.id,
      categoryId: expense.id,
      type: TransactionType.EXPENSE,
      name: "Insurance",
      amountCents: 25_000,
      cadence: RecurringCadence.MONTHLY,
      nextExpectedDate: nextMonthThird,
      endDate: nextMonthThird,
    },
  });

  await signInWithPassword(page, email, "e2e-password-123");
  await expectDashboardHome(page);
  await page.getByRole("tab", { name: "Safe to spend" }).click();
  await expect(page.getByTestId("safe-to-spend-amount")).toHaveText("$1,000.00");

  const buffer = page.getByTestId("safe-to-spend-buffer");
  await buffer.getByLabel("Bill buffer").fill("61");
  await buffer.getByRole("button", { name: "Save" }).click();
  await expect(buffer).toContainText("from 1 to 60");

  await buffer.getByLabel("Bill buffer").fill("60");
  await buffer.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("safe-to-spend-amount")).toHaveText("$750.00");
  await expect(page.getByTestId("safe-to-spend-buffer-note")).toContainText("(60-day buffer)");
  await expect(page.getByTestId("safe-to-spend")).toContainText("Next month's bills to");
  expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).safeToSpendBufferDays).toBe(60);

  // Emptied, the buffer is off and only this month's bills count again.
  await buffer.getByLabel("Bill buffer").fill("");
  await buffer.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("safe-to-spend-amount")).toHaveText("$1,000.00");
  await expect(page.getByTestId("safe-to-spend-buffer-note")).toHaveCount(0);
  expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).safeToSpendBufferDays).toBeNull();
});
