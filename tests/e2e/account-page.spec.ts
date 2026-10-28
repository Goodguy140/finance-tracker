import { expect, test } from "@playwright/test";
import { AccountType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { expectDashboardHome } from "./expect-dashboard-home";
import { hashTestPassword, signInWithPassword, uniqueStamp } from "./helpers";

test("account page: reached from net worth, with a running balance worked back from the latest reading", async ({ page }) => {
  const email = `e2e-account-page-${uniqueStamp()}@example.com`;
  const password = "e2e-password-123";
  const user = await prisma.user.create({
    data: { email, passwordHash: await hashTestPassword(password), displayName: "E2E", countryCode: "CA", role: "USER" },
  });
  await ensureDefaultDataForUser(user);
  const category = await prisma.category.findFirstOrThrow({ where: { userId: user.id, kind: "EXPENSE" } });
  const account = await prisma.account.create({ data: { userId: user.id, name: "Register Chequing", type: AccountType.CHEQUING } });
  const today = new Date();
  const dayOf = (n: number) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - n));
  await prisma.transaction.createMany({
    data: [
      { userId: user.id, accountId: account.id, categoryId: category.id, type: "EXPENSE", amountCents: 4_000, date: dayOf(3), title: "Older groceries" },
      { userId: user.id, accountId: account.id, categoryId: category.id, type: "EXPENSE", amountCents: 1_500, date: dayOf(1), title: "Newer lunch" },
    ],
  });
  await prisma.accountBalanceSnapshot.create({
    data: { userId: user.id, accountId: account.id, date: dayOf(1), balanceCents: 100_000, source: "MANUAL" },
  });

  await signInWithPassword(page, email, password);
  await expectDashboardHome(page);
  await page.goto("/reports");
  await page.getByTestId("report-net-worth").getByText("By account").click();
  await page.getByRole("link", { name: "Register Chequing" }).click();
  await expect(page.getByRole("heading", { name: "Register Chequing" })).toBeVisible();
  await expect(page.getByTestId("account-balance-now")).toHaveText("$1,000.00");

  const rows = page.getByTestId("register-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Newer lunch");
  await expect(rows.nth(0).getByTestId("register-balance")).toHaveText("$1,000.00");
  await expect(rows.nth(1)).toContainText("Older groceries");
  await expect(rows.nth(1).getByTestId("register-balance")).toHaveText("$1,015.00");
});
