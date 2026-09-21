import { expect, test } from "@playwright/test";
import { hash } from "bcryptjs";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { expectDashboardHome } from "./expect-dashboard-home";
import {
  addExpenseOnDashboard,
  expectExpenseInLog,
  openSettingsAdvancedTab,
  uniqueStamp,
} from "./helpers";

test("user can export and re-import sanitized backup", async ({ page }, testInfo) => {
  const stamp = uniqueStamp();
  const email = `e2e-backup-roundtrip-${stamp}@example.com`;
  const password = "e2e-password-123";
  const title = `Roundtrip ${stamp}`;

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hash(password, 12),
      displayName: "E2E User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);

  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Login" }).click();
  await expectDashboardHome(page);

  await page.goto("/");
  await addExpenseOnDashboard(page, testInfo.project.name, title, "12.50");

  const exportRes = await page.request.get("/api/backup/export/me");
  expect(exportRes.ok()).toBeTruthy();
  const backup = await exportRes.json();
  expect(backup.user.passwordHash).toBeNull();

  const backupPath = join(tmpdir(), `backup-roundtrip-${stamp}.json`);
  writeFileSync(backupPath, JSON.stringify(backup));

  try {
    await openSettingsAdvancedTab(page);
    await page.locator('input[name="backupJson"]').setInputFiles(backupPath);
    await page.getByRole("button", { name: "Import backup JSON" }).click();

    await expect.poll(async () => {
      const count = await prisma.transaction.count({
        where: { userId: user.id, title },
      });
      return count;
    }).toBeGreaterThan(0);

    await page.goto("/");
    await expectExpenseInLog(page, title);

    const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(dbUser.role).toBe("USER");
  } finally {
    unlinkSync(backupPath);
  }
});

test("a verified transaction keeps its badge across an export/import, without carrying Plaid ids", async ({
  page,
}, testInfo) => {
  const stamp = uniqueStamp();
  const email = `e2e-backup-verified-${stamp}@example.com`;
  const password = "e2e-password-123";
  const title = `Verified ${stamp}`;

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hash(password, 12),
      displayName: "E2E User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);

  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Login" }).click();
  await expectDashboardHome(page);
  await page.goto("/");
  await addExpenseOnDashboard(page, testInfo.project.name, title, "84.21");

  const txn = await prisma.transaction.findFirstOrThrow({ where: { userId: user.id, title } });
  // Stand in for what the review queue will write once syncing exists: a Plaid-backed
  // verification carrying identifiers that must never leave this deployment.
  await prisma.transactionVerification.create({
    data: {
      userId: user.id,
      transactionId: txn.id,
      source: "MATCHED",
      institutionName: "Test Credit Union",
      plaidTransactionId: `plaid-txn-${stamp}`,
      plaidItemId: `plaid-item-${stamp}`,
      plaidAccountRowId: `plaid-acct-${stamp}`,
    },
  });

  const exportRes = await page.request.get("/api/backup/export/me");
  expect(exportRes.ok()).toBeTruthy();
  const backup = await exportRes.json();

  expect(backup.transactionVerifications).toHaveLength(1);
  expect(backup.transactionVerifications[0].source).toBe("MATCHED");
  expect(backup.transactionVerifications[0].institutionName).toBe("Test Credit Union");
  expect(backup.transactionVerifications[0].transactionId).toBe(txn.id);

  // The whole point: the fact of verification travels, the Plaid identifiers do not.
  const serialized = JSON.stringify(backup);
  expect(serialized).not.toContain(`plaid-txn-${stamp}`);
  expect(serialized).not.toContain(`plaid-item-${stamp}`);
  expect(serialized).not.toContain(`plaid-acct-${stamp}`);

  const backupPath = join(tmpdir(), `backup-verified-${stamp}.json`);
  writeFileSync(backupPath, JSON.stringify(backup));

  try {
    await openSettingsAdvancedTab(page);
    await page.locator('input[name="backupJson"]').setInputFiles(backupPath);
    await page.getByRole("button", { name: "Import backup JSON" }).click();

    // Poll for the *replacement*, not merely for a row: the import deletes and recreates
    // everything, so the pre-import row would satisfy a plain count and the assertions
    // below would then be checking the original rather than the restored one.
    await expect
      .poll(async () => {
        const row = await prisma.transactionVerification.findFirst({
          where: { userId: user.id, transaction: { title } },
          select: { transactionId: true },
        });
        return row && row.transactionId !== txn.id ? "replaced" : "original";
      })
      .toBe("replaced");

    const restored = await prisma.transactionVerification.findFirstOrThrow({
      where: { userId: user.id, transaction: { title } },
    });
    expect(restored.source).toBe("MATCHED");
    expect(restored.institutionName).toBe("Test Credit Union");
    // Restored with no Plaid linkage: the badge is honest about the transaction having been
    // confirmed against a bank without implying this deployment still has a connection.
    expect(restored.plaidTransactionId).toBeNull();
    expect(restored.plaidItemId).toBeNull();
  } finally {
    unlinkSync(backupPath);
  }
});
