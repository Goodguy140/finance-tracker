import { expect, type Page } from "@playwright/test";

export function expenseLogLocator(page: Page) {
  return page.getByRole("heading", { name: "Expense Log" }).locator("..").locator("..");
}

export async function expectExpenseInLog(page: Page, title: string) {
  const expenseLog = expenseLogLocator(page);
  const titles = expenseLog.getByText(title, { exact: true });
  await expect
    .poll(async () => {
      const count = await titles.count();
      for (let i = 0; i < count; i++) {
        if (await titles.nth(i).isVisible()) return true;
      }
      return false;
    })
    .toBe(true);
}

export async function openSettingsAdvancedTab(page: Page) {
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Advanced" }).click();
  await expect(page.getByRole("tabpanel", { name: "Advanced" })).toBeVisible();
}

export async function addExpenseOnDashboard(
  page: Page,
  projectName: string,
  title: string,
  amount: string,
) {
  if (projectName === "mobile-chromium") {
    await page.getByRole("button", { name: "Quick add expense" }).click();
    const sheet = page.getByRole("dialog", { name: "Add expense" });
    await expect(sheet).toBeVisible();
    await sheet.getByPlaceholder("e.g. Weekly groceries, Shell fuel").fill(title);
    await sheet.locator('input[name="amount"]').fill(amount);
    await sheet.getByRole("button", { name: "Add expense" }).click();
  } else {
    const section = page.locator("section").filter({
      has: page.getByRole("heading", { name: "Add Expense" }),
    });
    await section.getByPlaceholder("e.g. Weekly groceries, Shell fuel").fill(title);
    await section.locator('input[name="amount"]').fill(amount);
    await section.getByRole("button", { name: "Add expense" }).click();
  }
  await expectExpenseInLog(page, title);
}
