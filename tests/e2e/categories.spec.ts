import { expect, test, type Page } from "@playwright/test";
import { CategoryKind, TransactionType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { shiftYm } from "../../src/lib/dashboard-period";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { currentYmInTimeZone } from "../../src/lib/period-month";
import { expectDashboardHome } from "./expect-dashboard-home";
import { hashTestPassword, signInWithPassword, uniqueStamp } from "./helpers";

const PASSWORD = "e2e-password-123";

async function createUserAndLogin(page: Page) {
  const stamp = uniqueStamp();
  const email = `e2e-categories-${stamp}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword(PASSWORD),
      displayName: "E2E Categories User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  await signInWithPassword(page, email, PASSWORD);
  await expectDashboardHome(page);
  return { user, stamp: stamp.replace(/[^a-z0-9]/gi, "") };
}

test("categories can be added with a budget, merged by renaming, and Plaid categories mapped", async ({
  page,
}, testInfo) => {
  const { user, stamp } = await createUserAndLogin(page);
  const name = `Pets ${stamp}`;

  await page.goto("/settings/categories");
  const panel = page.getByRole("region", { name: "Categories & budgets" });

  // Add, with a budget.
  await panel.getByRole("button", { name: "New category" }).click();
  const add = page.getByRole("dialog", { name: "New category" });
  await add.getByPlaceholder("e.g. Pets").fill(name);
  await add.getByPlaceholder("Optional").fill("80");
  await add.getByRole("button", { name: "Add category" }).click();
  await expect(add).toBeHidden();
  const row = panel.getByTestId("category-row").filter({ hasText: name });
  await expect(row).toContainText("$80.00/mo");
  const pets = await prisma.category.findFirstOrThrow({ where: { userId: user.id, name } });

  // Merge it into Fun by renaming it to that name; its transaction moves across.
  const fun = await prisma.category.findFirstOrThrow({
    where: { userId: user.id, name: "Fun", kind: CategoryKind.EXPENSE },
  });
  const account = await prisma.account.findFirstOrThrow({ where: { userId: user.id } });
  const tx = await prisma.transaction.create({
    data: {
      userId: user.id,
      accountId: account.id,
      categoryId: pets.id,
      type: TransactionType.EXPENSE,
      amountCents: 1234,
      date: new Date(),
      title: `Kibble ${stamp}`,
    },
  });
  await page.reload();
  await row.locator("summary").click();
  await row.getByLabel(`New name for ${name}`).fill("Fun");
  await row.getByRole("button", { name: "Rename" }).click();
  // The merge is confirmed in the page's own dialog, not the browser's.
  await page.getByRole("dialog", { name: `Merge “${name}” into “Fun”?` }).getByRole("button", { name: "Merge" }).click();
  await expect(panel.getByTestId("category-row").filter({ hasText: name })).toHaveCount(0);
  // Deleting the category is the merge's last write.
  await expect.poll(async () => prisma.category.count({ where: { id: pets.id } })).toBe(0);
  expect((await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } })).categoryId).toBe(fun.id);

  // Map Plaid's groceries onto Groceries.
  const groceries = await prisma.category.findFirstOrThrow({
    where: { userId: user.id, name: "Groceries", kind: CategoryKind.EXPENSE },
  });
  // Folded by default: most people never change it.
  await panel.getByText("Bank category mapping", { exact: true }).click();
  const food = panel.getByTestId("plaid-mapping-row").filter({ hasText: "Food and drink" });
  await expect(food.getByLabel("Category for Food and drink")).toHaveValue("");
  await expect(food.getByLabel("Category for Food and drink").locator("option").first()).toHaveText("Default: Dining");
  await food.getByText("More specific").click();
  await food.getByLabel("Category for Groceries").selectOption({ label: "Groceries" });
  await expect
    .poll(async () =>
      (await prisma.plaidCategoryMapping.findFirst({ where: { userId: user.id, plaidCategory: "FOOD_AND_DRINK_GROCERIES" } }))
        ?.categoryId,
    )
    .toBe(groceries.id);
  await food.screenshot({ path: testInfo.outputPath("plaid-mapping.png") });
  await panel.screenshot({ path: testInfo.outputPath("categories-tab.png") });
});

test("deleting a category in use asks, in the page, where its transactions and rules go", async ({ page }, testInfo) => {
  const { user, stamp } = await createUserAndLogin(page);
  const account = await prisma.account.findFirstOrThrow({ where: { userId: user.id } });
  const fun = await prisma.category.findFirstOrThrow({
    where: { userId: user.id, name: "Fun", kind: CategoryKind.EXPENSE },
  });
  // Used only by a recurring rule: no transactions, but still not deletable outright.
  const gym = await prisma.category.create({ data: { userId: user.id, name: `Gym ${stamp}`, kind: CategoryKind.EXPENSE } });
  const rule = await prisma.recurringTransaction.create({
    data: {
      userId: user.id,
      accountId: account.id,
      categoryId: gym.id,
      type: TransactionType.EXPENSE,
      name: "Membership",
      amountCents: 4000,
      cadence: "MONTHLY",
      nextExpectedDate: new Date(),
    },
  });

  await page.goto("/settings/categories");
  const panel = page.getByRole("region", { name: "Categories & budgets" });
  const row = panel.getByTestId("category-row").filter({ hasText: gym.name });
  await row.locator("summary").click();
  await expect(row).toContainText("Used by 1 recurring rule.");
  await row.getByRole("button", { name: `Delete ${gym.name}` }).click();

  const dialog = page.getByRole("dialog", { name: `Delete “${gym.name}”?` });
  await expect(dialog).toContainText("used by 1 recurring rule");
  await dialog.getByLabel(`Move ${gym.name}'s transactions to`).selectOption({ label: "Fun" });
  await dialog.screenshot({ path: testInfo.outputPath("delete-dialog.png") });
  await dialog.getByRole("button", { name: "Move and delete" }).click();

  await expect(dialog).toHaveCount(0);
  await expect(panel.getByTestId("category-row").filter({ hasText: gym.name })).toHaveCount(0);
  // Deleting the category is the merge's last write.
  await expect.poll(async () => prisma.category.count({ where: { id: gym.id } })).toBe(0);
  expect((await prisma.recurringTransaction.findUniqueOrThrow({ where: { id: rule.id } })).categoryId).toBe(fun.id);
});

test("budget rollover carries last month's leftover into this month's budget", async ({ page }, testInfo) => {
  const { user, stamp } = await createUserAndLogin(page);
  const account = await prisma.account.findFirstOrThrow({ where: { userId: user.id } });
  const thisYm = currentYmInTimeZone("America/Toronto");
  const lastYm = shiftYm(thisYm, -1);
  const books = await prisma.category.create({ data: { userId: user.id, name: `Books ${stamp}`, kind: CategoryKind.EXPENSE } });
  await prisma.budget.create({ data: { userId: user.id, categoryId: books.id, periodMonth: lastYm, limitCents: 10_000 } });
  await prisma.transaction.create({
    data: {
      userId: user.id,
      accountId: account.id,
      categoryId: books.id,
      type: TransactionType.EXPENSE,
      amountCents: 3_500,
      date: new Date(`${lastYm}-15T00:00:00Z`),
      title: `Novel ${stamp}`,
    },
  });

  await page.goto("/settings/categories");
  const panel = page.getByRole("region", { name: "Categories & budgets" });
  const row = panel.getByTestId("category-row").filter({ hasText: books.name });
  await row.locator("summary").click();
  await row.getByLabel(`Roll over ${books.name}'s budget`).check();
  await expect
    .poll(async () => (await prisma.category.findUniqueOrThrow({ where: { id: books.id } })).rolloverSinceMonth)
    .toBe(thisYm);
  await expect(row).toContainText("carries into next month");

  // As if it had been turned on last month: last month's $65 left over is this month's to spend.
  await prisma.category.update({ where: { id: books.id }, data: { rolloverSinceMonth: lastYm } });
  await page.reload();
  await row.locator("summary").click();
  await expect(row).toContainText("$65.00 left over from earlier months is added to this month's budget.");
  await row.screenshot({ path: testInfo.outputPath("settings-row.png") });

  await page.goto("/");
  const card = page.getByRole("region", { name: "Budgets" });
  const budgetRow = card.locator("div.rounded-xl").filter({ hasText: books.name });
  await expect(budgetRow).toContainText("$0.00 / $165.00");
  await expect(budgetRow.getByTestId("budget-rollover-note")).toHaveText("Includes $65.00 left over from earlier months");
  await card.screenshot({ path: testInfo.outputPath("budgets-card.png") });
});
