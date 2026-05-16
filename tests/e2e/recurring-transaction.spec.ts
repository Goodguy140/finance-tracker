import { expect, test } from "@playwright/test";
import { hash } from "bcryptjs";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";

test("desktop: create and post a recurring expense", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop add menu flow is covered by the chromium project");

  const stamp = Date.now();
  const email = `e2e-recurring-${stamp}@example.com`;
  const password = "e2e-password-123";

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hash(password, 12),
      displayName: "E2E Recurring User",
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

  await expect(page).toHaveURL("/");

  await page.getByRole("button", { name: "Add" }).click();
  await page.getByRole("button", { name: "Recurring" }).click();

  const name = `Recurring gym ${stamp}`;
  await page.locator('textarea[name="name"]').fill(name);
  await page.locator('input[name="amount"]').fill("19.99");
  await page.locator('select[name="cadence"]').selectOption("MONTHLY");
  await page.locator('input[name="nextExpectedDate"]').fill("2026-05-16");
  await page.getByRole("button", { name: "Add recurring transaction" }).click();

  await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 15_000 });

  const recurringPanel = page.getByRole("heading", { name: "Recurring transactions" }).locator("..").locator("..");
  await recurringPanel.getByRole("button", { name: "Post transaction" }).click();

  const expenseLog = page.getByRole("heading", { name: "Expense Log" }).locator("..").locator("..");
  await expect(expenseLog.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await expect(recurringPanel.getByText(/Jun .*16.*2026/)).toBeVisible({ timeout: 15_000 });
});
