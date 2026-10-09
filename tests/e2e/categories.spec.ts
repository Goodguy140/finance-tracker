import { expect, test, type Page } from "@playwright/test";
import { hash } from "bcryptjs";
import { CategoryKind, TransactionType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { expectDashboardHome } from "./expect-dashboard-home";
import { uniqueStamp } from "./helpers";

const PASSWORD = "e2e-password-123";

async function createUserAndLogin(page: Page) {
  const stamp = uniqueStamp();
  const email = `e2e-categories-${stamp}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hash(PASSWORD, 12),
      displayName: "E2E Categories User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Login" }).click();
  await expectDashboardHome(page);
  return { user, stamp: stamp.replace(/[^a-z0-9]/gi, "") };
}

test("categories can be added with a budget, merged by renaming, and Plaid categories mapped", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Settings flow is covered by the chromium project");
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
  await panel.getByText("Bank category mapping").click();
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
  test.skip(testInfo.project.name !== "chromium", "Settings flow is covered by the chromium project");
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
