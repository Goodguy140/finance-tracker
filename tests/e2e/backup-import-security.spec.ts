import { expect, test } from "@playwright/test";
import { hash } from "bcryptjs";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { expectDashboardHome } from "./expect-dashboard-home";
import { openSettingsAdvancedTab } from "./helpers";

test("backup import cannot escalate user to server admin", async ({ page }) => {
  const stamp = Date.now();
  const email = `e2e-backup-sec-${stamp}@example.com`;
  const password = "e2e-password-123";
  const iso = "2026-01-01T00:00:00.000Z";

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

  const backup = {
    version: 1,
    exportedAt: iso,
    user: {
      email,
      displayName: "Escalated Name",
      timezone: "America/Toronto",
      countryCode: "CA",
      role: "SERVER_ADMIN",
      passwordHash: "$2a$12$fakehashfakehashfakehashfake",
      emailVerifiedAt: null,
      createdAt: iso,
      updatedAt: iso,
    },
    authAccounts: [],
    passwordResetTokens: [],
    accounts: [],
    categories: [],
    transactions: [],
    budgets: [],
    recurringTransactions: [],
    investmentFlows: [],
    portfolioSnapshots: [],
  };

  const backupPath = join(tmpdir(), `backup-${stamp}.json`);
  writeFileSync(backupPath, JSON.stringify(backup));

  try {
    await page.goto("/login");
    await page.getByPlaceholder("Email").fill(email);
    await page.getByPlaceholder("Password").fill(password);
    await page.getByRole("button", { name: "Login" }).click();
    await expectDashboardHome(page);

    await openSettingsAdvancedTab(page);
    await page.locator('input[name="backupJson"]').setInputFiles(backupPath);
    await page.getByRole("button", { name: "Import backup JSON" }).click();

    await expect.poll(async () => {
      const row = await prisma.user.findUnique({ where: { id: user.id } });
      return row?.displayName ?? "";
    }).toBe("Escalated Name");

    await expect(page.getByRole("link", { name: "Server admin" })).toHaveCount(0);

    const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(dbUser.role).toBe("USER");
    expect(dbUser.displayName).toBe("Escalated Name");
  } finally {
    unlinkSync(backupPath);
  }
});
