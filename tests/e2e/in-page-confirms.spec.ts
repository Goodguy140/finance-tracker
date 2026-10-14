import { expect, test, type Page } from "@playwright/test";
import { hash } from "bcryptjs";
import { CategoryKind, TransactionType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { expectDashboardHome } from "./expect-dashboard-home";
import { expenseLogLocator, uniqueStamp } from "./helpers";

// Deleting an expense or income entry and resetting the layout ask in an in-page dialog. A
// browser confirm box would fire this listener, and Playwright would otherwise auto-dismiss it
// and let the test carry on as if nothing happened.
function failOnBrowserDialog(page: Page) {
  page.on("dialog", (dialog) => {
    void dialog.dismiss();
    throw new Error(`Unexpected browser ${dialog.type()}: ${dialog.message()}`);
  });
}

async function signInWithEntries(page: Page, layout?: object) {
  const stamp = uniqueStamp();
  const email = `e2e-confirm-${stamp}@example.com`;
  const password = "e2e-password-123";
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hash(password, 12),
      displayName: "E2E Confirm User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  const [category, incomeCategory, account] = await Promise.all([
    prisma.category.findFirstOrThrow({ where: { userId: user.id, kind: CategoryKind.EXPENSE } }),
    prisma.category.findFirstOrThrow({ where: { userId: user.id, kind: CategoryKind.INCOME } }),
    prisma.account.findFirstOrThrow({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
  ]);

  // Mid-month UTC date so the dashboard's month period contains it in any timezone.
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15));
  const expenseTitle = `Groceries ${stamp}`;
  const incomeTitle = `Paycheque ${stamp}`;
  const [expense, income] = await Promise.all([
    prisma.transaction.create({
      data: {
        userId: user.id,
        type: TransactionType.EXPENSE,
        amountCents: 4200,
        date,
        title: expenseTitle,
        categoryId: category.id,
        accountId: account.id,
      },
    }),
    prisma.transaction.create({
      data: {
        userId: user.id,
        type: TransactionType.INCOME,
        amountCents: 250000,
        date,
        title: incomeTitle,
        categoryId: incomeCategory.id,
        accountId: account.id,
      },
    }),
  ]);

  if (layout) {
    await prisma.dashboardLayout.create({ data: { userId: user.id, version: 1, layoutJson: JSON.stringify(layout) } });
  }

  failOnBrowserDialog(page);
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Login" }).click();
  await expectDashboardHome(page);
  return { user, expense, income, expenseTitle, incomeTitle };
}

test("deleting an expense asks in the page, and Cancel keeps it", async ({ page }) => {
  const { expense, expenseTitle } = await signInWithEntries(page);

  const log = expenseLogLocator(page);
  await log.getByRole("button").filter({ hasText: expenseTitle }).filter({ visible: true }).first().click();
  const editor = page.getByRole("dialog", { name: "Edit expense" });

  await editor.getByRole("button", { name: "Delete expense" }).click();
  const confirm = page.getByRole("dialog", { name: "Delete this expense?" });
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden();
  // Escape inside the confirmation closes only the confirmation, not the edit dialog under it.
  await editor.getByRole("button", { name: "Delete expense" }).click();
  await page.keyboard.press("Escape");
  await expect(confirm).toBeHidden();
  await expect(editor).toBeVisible();
  expect(await prisma.transaction.findUnique({ where: { id: expense.id } })).not.toBeNull();

  await editor.getByRole("button", { name: "Delete expense" }).click();
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(editor).toBeHidden();
  await expect.poll(() => prisma.transaction.findUnique({ where: { id: expense.id } })).toBeNull();
});

test("deleting income asks in the page", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const { income, incomeTitle } = await signInWithEntries(page);
  // The dashboard adds ?month= to its URL just after load, and that re-render remounts the
  // Income card, closing an edit dialog opened before it lands.
  await expect(page).toHaveURL(/[?&]month=/);

  const card = page.getByRole("region", { name: "Income", exact: true });
  await card.getByRole("button").filter({ hasText: incomeTitle }).filter({ visible: true }).first().click();
  const editor = page.getByRole("dialog", { name: "Edit income" });

  await editor.getByRole("button", { name: "Delete income" }).click();
  const confirm = page.getByRole("dialog", { name: "Delete this income entry?" });
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden();
  expect(await prisma.transaction.findUnique({ where: { id: income.id } })).not.toBeNull();

  await editor.getByRole("button", { name: "Delete income" }).click();
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(editor).toBeHidden();
  await expect.poll(() => prisma.transaction.findUnique({ where: { id: income.id } })).toBeNull();
});

test("resetting the layout asks in the page", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "The arrangement UI only exists above lg");
  await page.setViewportSize({ width: 1600, height: 1000 });
  await signInWithEntries(page);

  await page.getByRole("button", { name: "Edit layout" }).click();
  await page.getByRole("button", { name: "Remove Upcoming bills" }).click();
  await expect(page.locator('[data-card-id="bills-forecast"]')).toHaveCount(0);

  await page.getByRole("button", { name: "Reset layout" }).click();
  const confirm = page.getByRole("dialog", { name: "Reset the dashboard?" });
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden();
  await expect(page.locator('[data-card-id="bills-forecast"]')).toHaveCount(0);

  await page.getByRole("button", { name: "Reset layout" }).click();
  await confirm.getByRole("button", { name: "Reset layout" }).click();
  await expect(page.locator('[data-card-id="bills-forecast"]')).not.toHaveCount(0);
});
