import { expect, test } from "@playwright/test";
import { hash } from "bcryptjs";
import { AccountType, CategoryKind, TransactionType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { expectDashboardHome } from "./expect-dashboard-home";
import { expenseLogLocator, uniqueStamp } from "./helpers";

test("the edit dialog keeps Save and Delete in view while the form grows, and Save still saves", async ({ page }) => {
  const stamp = uniqueStamp();
  const email = `e2e-edit-dialog-${stamp}@example.com`;
  const password = "e2e-password-123";
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hash(password, 12),
      displayName: "E2E Edit Dialog",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  const [category, account] = await Promise.all([
    prisma.category.findFirstOrThrow({ where: { userId: user.id, kind: CategoryKind.EXPENSE } }),
    prisma.account.create({ data: { userId: user.id, name: "Visa Infinite", type: AccountType.CREDIT_CARD } }),
  ]);
  const now = new Date();
  const title = `Shell ${stamp}`;
  const expense = await prisma.transaction.create({
    data: {
      userId: user.id,
      type: TransactionType.EXPENSE,
      amountCents: 4800,
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

  await expenseLogLocator(page).getByRole("button").filter({ hasText: title }).filter({ visible: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Edit expense" });
  await expect(dialog).toBeVisible();

  // Open every optional section so the fields run well past the screen height.
  for (const name of ["Posted date", "Note", "Tags", "Receipt breakdown"]) {
    await dialog.getByRole("button", { name, exact: true }).click();
  }
  await expect(dialog.getByRole("textbox", { name: "Note" })).toBeVisible();

  const save = dialog.getByRole("button", { name: "Save changes" });
  await expect(save).toBeInViewport({ ratio: 1 });
  await expect(dialog.getByRole("button", { name: "Delete expense" })).toBeInViewport({ ratio: 1 });

  // Save sits outside the form now, so make sure it still submits it.
  await dialog.getByRole("button", { name: "Receipt breakdown", exact: true }).click();
  await dialog.getByPlaceholder("0.00 (negative for credits)").fill("52.25");
  await save.click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(async () => (await prisma.transaction.findUniqueOrThrow({ where: { id: expense.id } })).amountCents)
    .toBe(5225);
});
