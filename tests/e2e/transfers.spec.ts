import { expect, test } from "@playwright/test";
import { hash } from "bcryptjs";
import { CategoryKind, TransactionType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { expectDashboardHome } from "./expect-dashboard-home";
import { expenseLogLocator, uniqueStamp } from "./helpers";

test("an expense marked as a transfer leaves the log for the transfers list, and comes back", async ({ page }) => {
  const stamp = uniqueStamp();
  const email = `e2e-transfer-${stamp}@example.com`;
  const password = "e2e-password-123";

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hash(password, 12),
      displayName: "E2E Transfer User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  const [category, account] = await Promise.all([
    prisma.category.findFirstOrThrow({ where: { userId: user.id, kind: CategoryKind.EXPENSE } }),
    prisma.account.findFirstOrThrow({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
  ]);

  // Mid-month UTC date so the dashboard's month period contains it in any timezone.
  const now = new Date();
  const title = `Visa payment ${stamp}`;
  const payment = await prisma.transaction.create({
    data: {
      userId: user.id,
      type: TransactionType.EXPENSE,
      amountCents: 40000,
      date: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15)),
      title,
      categoryId: category.id,
      accountId: account.id,
    },
  });

  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Login" }).click();
  await expectDashboardHome(page);

  const log = expenseLogLocator(page);
  await log.getByRole("button").filter({ hasText: title }).filter({ visible: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Edit expense" });
  await dialog.getByRole("button", { name: "Mark as transfer" }).click();
  await expect(dialog).toBeHidden();

  // One write: the update that moves it.
  await expect
    .poll(async () => {
      const row = await prisma.transaction.findUniqueOrThrow({
        where: { id: payment.id },
        include: { category: true },
      });
      return [row.type, row.amountCents, row.category.kind];
    })
    .toEqual([TransactionType.TRANSFER, 40000, CategoryKind.TRANSFER]);

  await expect(log.getByText("No expenses in this period.").filter({ visible: true })).toHaveCount(1);
  const transfers = log.getByTestId("transfer-log").filter({ visible: true });
  await expect(transfers).toContainText("Transfers · 1");
  await transfers.getByRole("button", { name: /Transfers/ }).click();
  await expect(transfers).toContainText(title);
  await expect(transfers).toContainText("Out $400.00");

  await transfers.getByRole("button", { name: "Not a transfer: count as an expense" }).click();
  await expect
    .poll(async () => {
      const row = await prisma.transaction.findUniqueOrThrow({
        where: { id: payment.id },
        include: { category: true },
      });
      return [row.type, row.amountCents, row.category.kind];
    })
    .toEqual([TransactionType.EXPENSE, 40000, CategoryKind.EXPENSE]);
  await expect(log.getByTestId("transfer-log")).toHaveCount(0);
  await expect(log.getByText(title).filter({ visible: true }).first()).toBeVisible();
});
