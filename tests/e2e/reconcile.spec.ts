import { expect, test } from "@playwright/test";
import { AccountType, CategoryKind, TransactionType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { expectDashboardHome } from "./expect-dashboard-home";
import { hashTestPassword, signInWithPassword, uniqueStamp } from "./helpers";

test("a statement is checked against the log, then marked reconciled", async ({ page }) => {
  const email = `e2e-reconcile-${uniqueStamp()}@example.com`;
  const password = "e2e-password-123";
  const user = await prisma.user.create({
    data: { email, passwordHash: await hashTestPassword(password), displayName: "E2E", countryCode: "CA", role: "USER" },
  });
  await ensureDefaultDataForUser(user);
  const account = await prisma.account.create({ data: { userId: user.id, name: "Statement Chequing", type: AccountType.CHEQUING } });
  const [expenseCat, incomeCat] = await Promise.all([
    prisma.category.findFirstOrThrow({ where: { userId: user.id, kind: CategoryKind.EXPENSE } }),
    prisma.category.findFirstOrThrow({ where: { userId: user.id, kind: CategoryKind.INCOME } }),
  ]);
  await prisma.transaction.createMany({
    data: [
      { userId: user.id, accountId: account.id, categoryId: incomeCat.id, type: TransactionType.INCOME, amountCents: 200_000, title: "Pay", date: new Date("2026-09-01T00:00:00Z") },
      { userId: user.id, accountId: account.id, categoryId: expenseCat.id, type: TransactionType.EXPENSE, amountCents: 45_000, title: "Groceries", date: new Date("2026-09-12T00:00:00Z") },
      // Outside the statement's dates.
      { userId: user.id, accountId: account.id, categoryId: expenseCat.id, type: TransactionType.EXPENSE, amountCents: 9_999, title: "October", date: new Date("2026-10-01T00:00:00Z") },
    ],
  });

  await signInWithPassword(page, email, password);
  await expectDashboardHome(page);
  await page.goto("/settings/accounts");
  await page.getByRole("link", { name: "Reconcile" }).click();

  const form = page.getByTestId("reconcile-form");
  await form.getByLabel("Account").selectOption({ label: "Statement Chequing" });
  await form.getByLabel("Statement from").fill("2026-09-01");
  await form.getByLabel("to", { exact: true }).fill("2026-09-30");
  await form.getByLabel("Opening balance").fill("1,000.00");
  await form.getByLabel("Closing balance").fill("2,500.00");
  await form.getByRole("button", { name: "Check" }).click();

  const result = page.getByTestId("reconcile-result");
  await expect(result.getByTestId("reconcile-difference")).toContainText("Off by $50.00");
  await expect(result).toContainText("Groceries");
  await expect(result).not.toContainText("October");

  await form.getByLabel("Closing balance").fill("2,550.00");
  await form.getByRole("button", { name: "Check" }).click();
  await expect(result.getByRole("status")).toContainText("It matches");
  await result.getByRole("button", { name: "Mark reconciled" }).click();

  await expect(page.getByTestId("reconcile-history")).toContainText("$1,000.00 to $2,550.00");
  const saved = await prisma.accountReconciliation.findFirstOrThrow({ where: { accountId: account.id } });
  expect(saved).toMatchObject({ openingCents: 100_000, closingCents: 255_000 });
  const snapshot = await prisma.accountBalanceSnapshot.findFirstOrThrow({ where: { accountId: account.id } });
  expect(snapshot).toMatchObject({ balanceCents: 255_000, source: "MANUAL", date: new Date("2026-09-30T00:00:00Z") });
});
