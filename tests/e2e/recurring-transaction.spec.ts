import { expect, test } from "@playwright/test";
import { hash } from "bcryptjs";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { expectDashboardHome } from "./expect-dashboard-home";
import { expectExpenseInLog, uniqueStamp } from "./helpers";

function recurringExpenseDates(reference = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = reference.getFullYear();
  const monthIndex = reference.getMonth();
  const periodYm = `${year}-${pad(monthIndex + 1)}`;
  const nextExpectedDate = `${periodYm}-16`;
  const afterPost = new Date(year, monthIndex + 1, 16);
  const nextDuePattern = new RegExp(
    `${afterPost.toLocaleString("en-US", { month: "short" })}.*16.*${afterPost.getFullYear()}`,
  );
  return { nextExpectedDate, nextDuePattern };
}

test("desktop: create and post a recurring expense", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop add menu flow is covered by the chromium project");

  const stamp = uniqueStamp();
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

  await expectDashboardHome(page);

  await page.getByRole("button", { name: "Add", exact: true }).click();
  const addDialog = page.getByRole("dialog", { name: "Add transaction" });
  await addDialog.getByRole("button", { name: "Recurring" }).click();

  const { nextExpectedDate, nextDuePattern } = recurringExpenseDates();
  const name = `Recurring gym ${stamp}`;
  await addDialog.locator('textarea[name="name"]').fill(name);
  await addDialog.locator('input[name="amount"]').fill("19.99");
  await addDialog.locator('select[name="cadence"]').selectOption("MONTHLY");
  await addDialog.locator('input[name="nextExpectedDate"]').fill(nextExpectedDate);
  await addDialog.getByRole("button", { name: "Add recurring transaction" }).click();
  await addDialog.getByRole("button", { name: "Close" }).click();

  await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 15_000 });

  const recurringPanel = page.getByRole("heading", { name: "Recurring transactions" }).locator("..").locator("..");
  await recurringPanel.getByRole("button", { name: "Post transaction" }).click();

  await expectExpenseInLog(page, name);
  await expect(recurringPanel.getByText(nextDuePattern)).toBeVisible({ timeout: 15_000 });
});
