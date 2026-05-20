import { expect, test } from "@playwright/test";
import { hash } from "bcryptjs";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { expectDashboardHome } from "./expect-dashboard-home";
import { addExpenseOnDashboard, openSettingsAdvancedTab } from "./helpers";

test("user can export and re-import sanitized backup", async ({ page }, testInfo) => {
  const stamp = Date.now();
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
    await expect(page.getByText(title, { exact: true }).first()).toBeVisible({ timeout: 15_000 });

    const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(dbUser.role).toBe("USER");
  } finally {
    unlinkSync(backupPath);
  }
});
