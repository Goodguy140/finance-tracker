import { expect, test } from "@playwright/test";
import { unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { CategoryKind, TransactionType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { expectDashboardHome } from "./expect-dashboard-home";
import { expenseLogLocator, hashTestPassword, openSettingsAdvancedTab, signInWithPassword, uniqueStamp } from "./helpers";

test("part of an expense owed by a friend leaves the spend, is listed as owed, and can be marked paid", async ({
  page,
}) => {
  const stamp = uniqueStamp();
  const email = `e2e-owed-${stamp}@example.com`;
  const password = "e2e-password-123";

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword(password),
      displayName: "E2E Owed User",
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
  const title = `Dinner ${stamp}`;
  const dinner = await prisma.transaction.create({
    data: {
      userId: user.id,
      type: TransactionType.EXPENSE,
      amountCents: 12000,
      date: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15)),
      title,
      categoryId: category.id,
      accountId: account.id,
    },
  });

  await signInWithPassword(page, email, password);
  await expectDashboardHome(page);

  const log = expenseLogLocator(page);
  await expect(log.getByTestId("owed-to-you")).toHaveCount(0);
  await log.getByRole("button").filter({ hasText: title }).filter({ visible: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Edit expense" });
  await dialog.getByRole("button", { name: "Someone owes me" }).click();
  await dialog.getByLabel("Who owes amount 1").fill("Sam");
  await dialog.getByTestId("owed-shares-editor").getByPlaceholder("0.00").fill("45");
  await expect(dialog.getByTestId("owed-own-part-preview")).toHaveText("75.00");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toBeHidden();

  // The share is the save's last write.
  await expect
    .poll(async () => (await prisma.owedShare.findMany({ where: { transactionId: dinner.id } })).map((s) => s.amountCents))
    .toEqual([4500]);
  expect((await prisma.transaction.findUniqueOrThrow({ where: { id: dinner.id } })).amountCents).toBe(7500);

  const owed = log.getByTestId("owed-to-you").filter({ visible: true });
  await expect(owed).toContainText("Sam");
  await expect(owed.getByTestId("owed-to-you-total")).toHaveText("$45.00 outstanding");
  await expect(log.getByTestId("expense-owed-breakdown").filter({ visible: true }).first()).toContainText("Paid $120.00");

  await owed.getByRole("button", { name: "Mark Sam paid" }).click();
  await expect
    .poll(async () => (await prisma.owedShare.findFirstOrThrow({ where: { transactionId: dinner.id } })).paidAt !== null)
    .toBe(true);
  await expect(owed.getByTestId("owed-to-you-total")).toHaveText("All paid back");
  // Being paid back changes no total: the share was never the user's spending.
  expect((await prisma.transaction.findUniqueOrThrow({ where: { id: dinner.id } })).amountCents).toBe(7500);
});

test("what others owe survives a backup export and import", async ({ page }) => {
  const stamp = uniqueStamp();
  const email = `e2e-owed-backup-${stamp}@example.com`;
  const password = "e2e-password-123";
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword(password),
      displayName: "E2E Owed Backup",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  const category = await prisma.category.findFirstOrThrow({ where: { userId: user.id, kind: CategoryKind.EXPENSE } });
  const title = `Trip ${stamp}`;
  const original = await prisma.transaction.create({
    data: {
      userId: user.id,
      type: TransactionType.EXPENSE,
      amountCents: 30000,
      date: new Date("2026-08-15T00:00:00Z"),
      title,
      categoryId: category.id,
      owedShares: {
        create: [
          { userId: user.id, name: "Sam", amountCents: 20000, paidAt: new Date("2026-08-20T12:00:00Z") },
          { userId: user.id, name: "Alex", amountCents: 10000 },
        ],
      },
    },
  });

  await signInWithPassword(page, email, password);
  await expectDashboardHome(page);

  const exportRes = await page.request.get("/api/backup/export/me");
  expect(exportRes.ok()).toBeTruthy();
  const backup = await exportRes.json();
  const exported = backup.transactions.find((row: { title: string | null }) => row.title === title);
  expect(exported.owedShares.map((s: { name: string; amountCents: number; paidAt: string | null }) => [s.name, s.amountCents, s.paidAt])).toEqual([
    ["Sam", 20000, "2026-08-20T12:00:00.000Z"],
    ["Alex", 10000, null],
  ]);

  const backupPath = join(tmpdir(), `backup-owed-${stamp}.json`);
  writeFileSync(backupPath, JSON.stringify(backup));
  try {
    await openSettingsAdvancedTab(page);
    await page.locator('input[name="backupJson"]').setInputFiles(backupPath);
    await page.getByRole("button", { name: "Import backup JSON" }).click();

    // Restoring replaces the user's rows, so the shares to look for hang off a new expense.
    await expect
      .poll(async () =>
        (
          await prisma.owedShare.findMany({
            where: { userId: user.id, transaction: { title, id: { not: original.id } } },
            orderBy: { amountCents: "desc" },
          })
        ).map((s) => [s.name, s.amountCents, s.paidAt?.toISOString() ?? null]),
      )
      .toEqual([
        ["Sam", 20000, "2026-08-20T12:00:00.000Z"],
        ["Alex", 10000, null],
      ]);
  } finally {
    unlinkSync(backupPath);
  }
});
