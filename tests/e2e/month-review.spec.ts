import { expect, test } from "@playwright/test";
import { CategoryKind, TransactionType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { expectDashboardHome } from "./expect-dashboard-home";
import { hashTestPassword, signInWithPassword, uniqueStamp } from "./helpers";

test("the monthly review recaps a month and marks it closed", async ({ page }) => {
  const stamp = uniqueStamp().replace(/[^a-z0-9]/gi, "");
  const email = `e2e-month-${stamp}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword("e2e-password-123"),
      displayName: "E2E Month User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  const account = await prisma.account.findFirstOrThrow({ where: { userId: user.id } });
  const category = await prisma.category.findFirstOrThrow({ where: { userId: user.id, kind: CategoryKind.EXPENSE } });
  const spend = (title: string, amountCents: number, ymd: string) =>
    prisma.transaction.create({
      data: {
        userId: user.id,
        accountId: account.id,
        categoryId: category.id,
        type: TransactionType.EXPENSE,
        amountCents,
        title,
        date: new Date(`${ymd}T00:00:00Z`),
      },
    });
  await spend("February shop", 10_000, "2025-02-10");
  await spend("Big March shop", 30_000, "2025-03-05");
  await spend("Small March shop", 5_000, "2025-03-20");
  await prisma.budget.create({
    data: { userId: user.id, categoryId: category.id, periodMonth: "2025-03", limitCents: 20_000 },
  });

  await signInWithPassword(page, email, "e2e-password-123");
  await expectDashboardHome(page);
  await page.goto("/reports/month?month=2025-03");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("March 2025 review");
  await expect(page.getByTestId("month-totals")).toContainText("Spending$350.00");
  await expect(page.getByText("You spent 250% more than in February 2025.")).toBeVisible();
  await expect(page.getByTestId("month-budgets")).toContainText("Kept 0 of 1.");
  await expect(page.getByTestId("month-budgets")).toContainText("over by $150.00");

  await page.getByRole("button", { name: "Mark month closed" }).click();
  await expect(page.getByTestId("month-close")).toContainText("Closed");
  await expect
    .poll(() => prisma.monthClose.count({ where: { userId: user.id, ym: "2025-03" } }))
    .toBe(1);
});
