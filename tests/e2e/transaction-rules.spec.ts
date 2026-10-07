import { expect, test, type Page } from "@playwright/test";
import { hash } from "bcryptjs";
import { CategoryKind, TransactionType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { encryptSecret } from "../../src/lib/security";
import { expectDashboardHome } from "./expect-dashboard-home";
import { uniqueStamp } from "./helpers";

const PASSWORD = "e2e-password-123";

async function createUserAndLogin(page: Page, label: string) {
  const stamp = uniqueStamp();
  const email = `e2e-rules-${label}-${stamp}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hash(PASSWORD, 12),
      displayName: "E2E Rules User",
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

  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Login" }).click();
  await expectDashboardHome(page);
  return { user, stamp, categories, accounts };
}

function addExpenseCard(page: Page) {
  return page.getByRole("region", { name: "Add", exact: true });
}

test("a rule fills category and account on the add-expense form", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop form flow is covered by the chromium project");
  const { user, stamp, categories, accounts } = await createUserAndLogin(page, "fill");
  // The last category and account, so neither is what the form would pick by default.
  const category = categories[categories.length - 1];
  const account = accounts[accounts.length - 1];
  expect(categories.length).toBeGreaterThan(1);
  expect(accounts.length).toBeGreaterThan(1);
  const pattern = `rulematch${stamp.replace(/[^a-z0-9]/gi, "")}`;

  await page.goto("/settings#rules");
  const panel = page.getByRole("tabpanel", { name: "Rules" });
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "New rule" }).click();
  const editor = panel.getByRole("region", { name: "New rule" });
  await editor.locator('input[name="titlePattern"]').fill(pattern);
  await editor.locator('select[name="setCategoryId"]').selectOption(category.id);
  await editor.locator('select[name="setAccountId"]').selectOption(account.id);
  await editor.locator('input[name="setTitle"]').fill("Renamed by rule");
  await editor.getByRole("button", { name: "Create rule" }).click();

  await expect(panel.getByTestId("transaction-rule")).toContainText(pattern);
  await expect
    .poll(() => prisma.transactionRule.findFirst({ where: { userId: user.id } }))
    .toMatchObject({ titlePattern: pattern, setCategoryId: category.id, setAccountId: account.id, transactionType: "EXPENSE" });

  await page.goto("/");
  const card = addExpenseCard(page);
  const title = card.getByPlaceholder("e.g. Weekly groceries, Shell fuel");
  await title.fill(`Coffee ${pattern}`);
  await expect(card.locator('select[name="categoryId"]')).toHaveValue(category.id);
  await expect(card.locator('select[name="accountId"]')).toHaveValue(account.id);
  await expect(card.getByTestId("rule-autofill-hint")).toContainText("Filled in by your rules");
  await card.locator('input[name="amount"]').fill("4.25");
  // Leaving the title applies the rename.
  await expect(title).toHaveValue("Renamed by rule");
  await card.getByRole("button", { name: "Add expense", exact: true }).click();

  await expect
    .poll(() =>
      prisma.transaction.findFirst({
        where: { userId: user.id, type: TransactionType.EXPENSE, amountCents: 425 },
        select: { title: true, categoryId: true, accountId: true },
      }),
    )
    .toEqual({ title: "Renamed by rule", categoryId: category.id, accountId: account.id });
});

test("learned combos are listed with the rules and can be hidden", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop form flow is covered by the chromium project");
  const { user, stamp, categories, accounts } = await createUserAndLogin(page, "learned");
  const category = categories[categories.length - 1];
  const learnedTitle = `Learned shop ${stamp}`;
  await prisma.transaction.create({
    data: {
      userId: user.id,
      accountId: accounts[0].id,
      categoryId: category.id,
      type: TransactionType.EXPENSE,
      amountCents: 1200,
      date: new Date(),
      title: learnedTitle,
    },
  });

  // The learned combo still auto-fills on the dashboard, as it did before rules existed.
  await page.goto("/");
  const card = addExpenseCard(page);
  await card.getByPlaceholder("e.g. Weekly groceries, Shell fuel").fill(learnedTitle);
  await expect(card.locator('select[name="categoryId"]')).toHaveValue(category.id);

  await page.goto("/settings#rules");
  const panel = page.getByRole("tabpanel", { name: "Rules" });
  const combo = panel.getByTestId("learned-combo").filter({ hasText: learnedTitle });
  await expect(combo).toContainText(category.name);
  await combo.getByRole("button", { name: `Hide ${learnedTitle}` }).click();

  await expect
    .poll(() => prisma.hiddenTitleSuggestion.count({ where: { userId: user.id } }))
    .toBe(1);
  await expect(panel.getByTestId("learned-combo").filter({ hasText: learnedTitle })).toHaveCount(0);
  await panel.getByText("Hidden (1)").click();
  await expect(panel.getByRole("button", { name: `Unhide ${learnedTitle}` })).toBeVisible();

  // Hidden: typing the title no longer changes the category away from the form's default.
  await page.goto("/");
  const reloaded = addExpenseCard(page);
  const categorySelect = reloaded.locator('select[name="categoryId"]');
  const initial = await categorySelect.inputValue();
  expect(initial).not.toBe(category.id);
  await reloaded.getByPlaceholder("e.g. Weekly groceries, Shell fuel").fill(learnedTitle);
  await expect(categorySelect).toHaveValue(initial);
});

test("a rule added after a sync applies to the bank row already waiting in the queue", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop queue flow is covered by the chromium project");
  const { user, stamp, categories, accounts } = await createUserAndLogin(page, "queue");
  const syncGuess = categories[0];
  const ruleCategory = categories[categories.length - 1];
  const account = accounts[0];
  const tagName = `groc${stamp.replace(/[^a-z0-9]/gi, "").slice(-8)}`;

  // A bank row staged before the rule exists, as a sync would have left it.
  const item = await prisma.plaidItem.create({
    data: {
      userId: user.id,
      itemId: `rules-item-${stamp}`,
      accessTokenEnc: encryptSecret(`access-sandbox-rules-${stamp}`),
      institutionName: "Test Credit Union",
      requestedDays: 90,
      historyCutoff: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
      lastSyncedAt: new Date(),
    },
  });
  const plaidAccount = await prisma.plaidAccount.create({
    data: {
      userId: user.id,
      plaidItemId: item.id,
      plaidAccountId: `rules-chq-${stamp}`,
      name: "Chequing",
      plaidType: "depository",
      accountId: account.id,
    },
  });
  const staged = await prisma.plaidStagedTransaction.create({
    data: {
      userId: user.id,
      plaidItemId: item.id,
      plaidAccountRowId: plaidAccount.id,
      plaidTransactionId: `rules-txn-${stamp}`,
      name: "LOBLAWS #1234 TORONTO ON",
      merchantName: "Loblaws",
      amountCents: 8421,
      type: TransactionType.EXPENSE,
      date: new Date(),
      suggestedAccountId: account.id,
      suggestedCategoryId: syncGuess.id,
    },
  });

  await page.goto("/settings#rules");
  const panel = page.getByRole("tabpanel", { name: "Rules" });
  await panel.getByRole("button", { name: "New rule" }).click();
  const editor = panel.getByRole("region", { name: "New rule" });
  await editor.locator('input[name="titlePattern"]').fill("loblaws");
  await editor.locator('select[name="setCategoryId"]').selectOption(ruleCategory.id);
  await editor.locator('input[name="setTitle"]').fill("Groceries run");
  await editor.locator('input[name="appendNote"]').fill("weekly shop");
  await editor.locator('input[name="addTag"]').fill(tagName);
  await editor.getByRole("button", { name: "Create rule" }).click();
  await expect(panel.getByTestId("transaction-rule")).toContainText("loblaws");

  // The queue shows what the rule will write before anything is added.
  await page.goto("/?range=lifetime");
  const card = page
    .locator("section")
    .filter({ hasText: "From your bank" })
    .first()
    .locator("li")
    .filter({ has: page.getByRole("group", { name: "What to do with Groceries run" }) });
  await expect(card).toContainText("Groceries run");
  await expect(card).toContainText("Loblaws ·");
  await expect(card).toContainText("filled in by your rules");
  await expect(card.getByTestId("review-rule-extras")).toContainText("weekly shop");
  await expect(card.getByTestId("tag-chip")).toHaveText(`#${tagName}`);
  await expect(card.locator('select[name="categoryId"]')).toHaveValue(ruleCategory.id);

  await card.getByRole("button", { name: "Add it" }).click();

  // The staged row's link to the transaction is the last thing adding it writes.
  await expect
    .poll(async () => (await prisma.plaidStagedTransaction.findUniqueOrThrow({ where: { id: staged.id } })).resolvedTransactionId, {
      timeout: 15_000,
    })
    .not.toBeNull();
  const resolved = await prisma.plaidStagedTransaction.findUniqueOrThrow({ where: { id: staged.id } });
  const added = await prisma.transaction.findUniqueOrThrow({
    where: { id: resolved.resolvedTransactionId! },
    include: { tags: { include: { tag: true } } },
  });
  expect(added).toMatchObject({
    title: "Groceries run",
    categoryId: ruleCategory.id,
    note: "weekly shop",
    amountCents: 8421,
    accountId: account.id,
  });
  expect(added.tags.map((t) => t.tag.name)).toEqual([tagName]);
});
