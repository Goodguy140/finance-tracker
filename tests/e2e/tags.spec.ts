import { expect, test, type Page } from "@playwright/test";
import { CategoryKind, TransactionType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { expectDashboardHome } from "./expect-dashboard-home";
import { expenseLogLocator, hashTestPassword, signInWithPassword, uniqueStamp } from "./helpers";

const PASSWORD = "e2e-password-123";

async function createUserAndLogin(page: Page, label: string) {
  const stamp = uniqueStamp();
  const email = `e2e-tags-${label}-${stamp}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword(PASSWORD),
      displayName: "E2E Tags User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  const [categories, accounts] = await Promise.all([
    prisma.category.findMany({ where: { userId: user.id, kind: CategoryKind.EXPENSE }, orderBy: { name: "asc" } }),
    prisma.account.findMany({ where: { userId: user.id, archived: false }, orderBy: { createdAt: "asc" } }),
  ]);

  await signInWithPassword(page, email, PASSWORD);
  await expectDashboardHome(page);
  return { user, stamp: stamp.replace(/[^a-z0-9]/gi, ""), categories, accounts };
}

/** Mid-month UTC, so the dashboard's current month contains it in any timezone. */
function thisMonth() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15));
}

async function tagNamesOf(transactionId: string) {
  const links = await prisma.transactionTag.findMany({ where: { transactionId }, include: { tag: true } });
  return links.map((link) => link.tag.name).sort();
}

test("a rule adds its tag on the add-expense form, and the log filters by it", async ({ page }) => {
  const { user, stamp, categories, accounts } = await createUserAndLogin(page, "rule");
  const pattern = `tagmatch${stamp}`;
  const tagName = `Trip ${stamp}`;
  await prisma.transaction.create({
    data: {
      userId: user.id,
      accountId: accounts[0].id,
      categoryId: categories[0].id,
      type: TransactionType.EXPENSE,
      amountCents: 999,
      date: thisMonth(),
      title: `Untagged ${stamp}`,
    },
  });

  await page.goto("/settings/rules");
  const panel = page.getByRole("region", { name: "Rules", exact: true });
  await panel.getByRole("button", { name: "New rule" }).click();
  const editor = panel.getByRole("region", { name: "New rule" });
  await editor.locator('input[name="titlePattern"]').fill(pattern);
  await editor.locator('input[name="addTag"]').fill(tagName);
  await editor.getByRole("button", { name: "Create rule" }).click();
  await expect(panel.getByTestId("transaction-rule")).toContainText(`tag + ${tagName}`);
  await page.goto("/settings/tags");
  await expect(page.getByTestId("tag-list")).toContainText(tagName);

  await page.goto("/");
  const card = page.getByRole("region", { name: "Add", exact: true });
  await card.getByPlaceholder("e.g. Weekly groceries, Shell fuel").fill(`Hotel ${pattern}`);
  // The rule opens the Tags field with its tag already in it.
  await expect(card.getByTestId("tag-input")).toContainText(tagName);
  await card.locator('input[name="amount"]').fill("120.00");
  await card.getByRole("button", { name: "Add expense", exact: true }).click();

  await expect
    .poll(async () => {
      const row = await prisma.transaction.findFirst({ where: { userId: user.id, amountCents: 12000 } });
      return row ? tagNamesOf(row.id) : null;
    })
    .toEqual([tagName]);

  await page.reload();
  const log = expenseLogLocator(page);
  await expect(log.getByTestId("tag-chip").filter({ hasText: `#${tagName}` }).filter({ visible: true })).toHaveCount(1);
  await expect(log.getByText(`Untagged ${stamp}`).filter({ visible: true })).toHaveCount(1);

  const tag = await prisma.tag.findFirstOrThrow({ where: { userId: user.id } });
  await log.getByTestId("tag-filter").filter({ visible: true }).selectOption(tag.id);
  await expect(page).toHaveURL(new RegExp(`[?&]tag=${tag.id}`));
  await expect(log.getByText(`Untagged ${stamp}`).filter({ visible: true })).toHaveCount(0);
  await expect(log.getByText(`Hotel ${pattern}`).filter({ visible: true })).toHaveCount(1);
});

test("tags are added and removed from the edit dialog", async ({ page }) => {
  const { user, stamp, categories, accounts } = await createUserAndLogin(page, "edit");
  const title = `Dinner ${stamp}`;
  const expense = await prisma.transaction.create({
    data: {
      userId: user.id,
      accountId: accounts[0].id,
      categoryId: categories[0].id,
      type: TransactionType.EXPENSE,
      amountCents: 4500,
      date: thisMonth(),
      title,
    },
  });
  await page.reload();

  const log = expenseLogLocator(page);
  await log.getByRole("button").filter({ hasText: title }).first().click();
  const dialog = page.getByRole("dialog", { name: "Edit expense" });
  await dialog.getByRole("button", { name: "Tags", exact: true }).click();
  const input = dialog.getByTestId("tag-input").getByRole("combobox");
  await input.fill("Reimbursable");
  await input.press("Enter");
  // Enter turns the text into a chip instead of submitting the dialog.
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Remove tag Reimbursable" })).toBeVisible();
  // Typed but not yet a chip: still saved.
  await input.fill("tax deductible");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => tagNamesOf(expense.id)).toEqual(["Reimbursable", "tax deductible"]);

  await log.getByRole("button").filter({ hasText: title }).first().click();
  await dialog.getByRole("button", { name: "Remove tag Reimbursable" }).click();
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => tagNamesOf(expense.id)).toEqual(["tax deductible"]);
  // Removing it from the transaction keeps the tag itself for next time.
  expect(await prisma.tag.count({ where: { userId: user.id } })).toBe(2);
});
