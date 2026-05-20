import { expect, test } from "@playwright/test";
import { hash } from "bcryptjs";
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { expectDashboardHome } from "./expect-dashboard-home";

test("user can export and re-import sanitized backup", async ({ page, request }) => {
  const stamp = Date.now();
  const email = `e2e-backup-roundtrip-${stamp}@example.com`;
  const password = "e2e-password-123";

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

  const category = await prisma.category.findFirstOrThrow({
    where: { userId: user.id, kind: "EXPENSE" },
  });
  const account = await prisma.account.findFirstOrThrow({
    where: { userId: user.id, archived: false },
  });

  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Login" }).click();
  await expectDashboardHome(page);

  await page.goto("/");
  await page.getByRole("button", { name: "Add expense" }).click();
  await page.getByLabel("Title").fill(`Roundtrip ${stamp}`);
  await page.getByLabel("Amount").fill("12.50");
  await page.getByRole("button", { name: "Save expense" }).click();
  await expect(page.getByText(`Roundtrip ${stamp}`)).toBeVisible();

  const exportRes = await request.get("/api/backup/export/me");
  expect(exportRes.ok()).toBeTruthy();
  const backup = await exportRes.json();
  expect(backup.user.passwordHash).toBeNull();

  const backupPath = join(tmpdir(), `backup-roundtrip-${stamp}.json`);
  writeFileSync(backupPath, JSON.stringify(backup));

  try {
    await page.goto("/settings");
    await page.getByRole("button", { name: "Advanced" }).click();
    await page.locator('input[name="backupJson"]').setInputFiles(backupPath);
    await page.getByRole("button", { name: "Import backup JSON" }).click();

    await page.goto("/");
    await expect(page.getByText(`Roundtrip ${stamp}`)).toBeVisible();

    const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(dbUser.role).toBe("USER");
  } finally {
    unlinkSync(backupPath);
  }

  void category;
  void account;
});
