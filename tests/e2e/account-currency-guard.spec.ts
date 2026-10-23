import { expect, test } from "@playwright/test";
import { AccountType, CategoryKind, TransactionType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { expectDashboardHome } from "./expect-dashboard-home";
import { hashTestPassword, signInWithPassword, uniqueStamp } from "./helpers";

// A transaction's amount means cents in its account's currency, so these two edits would
// quietly change what recorded history means. Both are refused, and nothing changes.
test("an account with history keeps its currency, and a USD account with history can't be deleted", async ({
  page,
}) => {
  const email = `e2e-account-currency-${uniqueStamp()}@example.com`;
  const password = "e2e-password-123";
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword(password),
      displayName: "E2E Account Currency User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  const groceries = await prisma.category.findFirstOrThrow({
    where: { userId: user.id, kind: CategoryKind.EXPENSE, name: "Groceries" },
  });
  const usd = await prisma.account.create({
    data: { userId: user.id, name: "US chequing", type: AccountType.CHEQUING, currency: "USD" },
  });
  const empty = await prisma.account.create({
    data: { userId: user.id, name: "Spare account", type: AccountType.SAVINGS, currency: "CAD" },
  });
  await prisma.transaction.create({
    data: {
      userId: user.id,
      accountId: usd.id,
      categoryId: groceries.id,
      type: TransactionType.EXPENSE,
      amountCents: 4_000,
      title: "Seattle groceries",
      date: new Date(),
    },
  });

  await signInWithPassword(page, email, password);
  await expectDashboardHome(page);

  await page.goto("/settings/accounts");
  const accounts = page.getByTestId("account-list");
  const error = page.getByRole("alertdialog");

  // Currency change on an account with a transaction: refused.
  await accounts.getByRole("button", { name: "Edit US chequing" }).click();
  const drawer = page.getByRole("dialog", { name: "US chequing" });
  await drawer.locator('input[name="currency"]').fill("CAD");
  await drawer.getByRole("button", { name: "Save account" }).click();
  await expect(error).toContainText("already has 1 transaction in USD");
  expect((await prisma.account.findUniqueOrThrow({ where: { id: usd.id } })).currency).toBe("USD");
  await error.getByRole("button", { name: "Dismiss" }).click();

  // Delete: refused, and the transaction keeps its account.
  await drawer.getByRole("button", { name: "Remove…" }).click();
  await page.getByRole("dialog", { name: "Remove “US chequing”?" }).getByRole("button", { name: "Remove account" }).click();
  await expect(error).toContainText("Archive it instead");
  expect(await prisma.account.count({ where: { id: usd.id } })).toBe(1);
  expect(await prisma.transaction.count({ where: { userId: user.id, accountId: usd.id } })).toBe(1);
  await error.getByRole("button", { name: "Dismiss" }).click();

  // An account with nothing recorded can still change currency.
  await page.goto("/settings/accounts");
  await accounts.getByRole("button", { name: "Edit Spare account" }).click();
  const spare = page.getByRole("dialog", { name: "Spare account" });
  await spare.locator('input[name="currency"]').fill("USD");
  await spare.getByRole("button", { name: "Save account" }).click();
  await expect(spare).toBeHidden();
  await expect.poll(async () => (await prisma.account.findUniqueOrThrow({ where: { id: empty.id } })).currency).toBe("USD");
});
