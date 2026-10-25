import { expect, test } from "@playwright/test";
import { CategoryKind, TransactionType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { currentYmInTimeZone } from "../../src/lib/period-month";
import { expectDashboardHome } from "./expect-dashboard-home";
import { hashTestPassword, signInWithPassword, uniqueStamp } from "./helpers";

test("zero-based mode turns Safe to spend into income still to assign", async ({ page }) => {
  const stamp = uniqueStamp().replace(/[^a-z0-9]/gi, "");
  const email = `e2e-zero-${stamp}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword("e2e-password-123"),
      displayName: "E2E Zero User",
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
  await prisma.budget.create({ data: { userId: user.id, categoryId: expense.id, periodMonth: ym, limitCents: 40_000 } });

  await signInWithPassword(page, email, "e2e-password-123");
  await expectDashboardHome(page);
  await page.getByRole("tab", { name: "Safe to spend" }).click();
  await expect(page.getByTestId("safe-to-spend-amount")).toHaveText("$600.00");

  await page.getByTestId("zero-based-toggle").check();
  await expect(page.getByTestId("zero-based-amount")).toHaveText("$600.00");
  await expect(page.getByTestId("zero-based")).toContainText("Assigned to budgets−$400.00");
  await expect.poll(async () => (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).zeroBasedBudgeting).toBe(true);

  // Assigning the rest gives every dollar a job.
  await prisma.budget.updateMany({ where: { userId: user.id }, data: { limitCents: 100_000 } });
  await page.reload();
  await page.getByRole("tab", { name: "Safe to spend" }).click();
  await expect(page.getByTestId("zero-based-amount")).toHaveText("$0.00");
  await expect(page.getByTestId("zero-based")).toContainText("Every dollar has a job.");
});
