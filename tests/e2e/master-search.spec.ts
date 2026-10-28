import { expect, test, type Page } from "@playwright/test";
import { CategoryKind, TransactionType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { expectDashboardHome } from "./expect-dashboard-home";
import { hashTestPassword, signInWithPassword, uniqueStamp } from "./helpers";

const isPhone = () => test.info().project.name === "mobile-chromium";

/** A user with one expense three months back, out of the dashboard's default month. */
async function seedUser(stamp: string) {
  const user = await prisma.user.create({
    data: {
      email: `e2e-search-${stamp}@example.com`,
      passwordHash: await hashTestPassword(),
      displayName: "E2E Search User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  const [category, account] = await Promise.all([
    prisma.category.findFirstOrThrow({ where: { userId: user.id, kind: CategoryKind.EXPENSE } }),
    prisma.account.findFirstOrThrow({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
  ]);
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 15));
  const title = `Espresso ${stamp}`;
  const expense = await prisma.transaction.create({
    data: { userId: user.id, type: TransactionType.EXPENSE, amountCents: 1234, date, title, categoryId: category.id, accountId: account.id },
  });
  return { user, title, expense, ym: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}` };
}

async function openSearch(page: Page) {
  await page.getByTestId("open-search").click();
  const dialog = page.getByTestId("search-dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

test("a transaction from another month is found and opens in its edit dialog", async ({ page }) => {
  const { user, title, ym } = await seedUser(uniqueStamp());
  await signInWithPassword(page, user.email);
  await expectDashboardHome(page);

  const dialog = await openSearch(page);
  await dialog.getByRole("combobox").fill(title);
  const result = dialog.getByRole("option").filter({ hasText: title });
  await expect(result).toContainText("−$12.34");
  await result.click();

  await expect(page).toHaveURL((url) => url.searchParams.get("month") === ym);
  const edit = page.getByRole("dialog", { name: "Edit expense" });
  await expect(edit).toBeVisible();
  await expect(edit.locator('[name="title"]')).toHaveValue(title);
  // Taken off the address once used, so a reload does not open it again.
  await expect(page).toHaveURL((url) => !url.searchParams.has("open"));
});

test("settings and actions are found by name and run from the search", async ({ page }) => {
  const { user } = await seedUser(uniqueStamp());
  await signInWithPassword(page, user.email);
  await expectDashboardHome(page);

  let dialog = await openSearch(page);
  await dialog.getByRole("combobox").fill("passkey");
  await expect(dialog.getByRole("option").first()).toContainText("Passkeys");
  await dialog.getByRole("combobox").press("Enter");
  await expect(page).toHaveURL(/\/settings\/security$/);

  // From another page, "Add transfer" goes to the dashboard with the transfer form open.
  dialog = await openSearch(page);
  await dialog.getByRole("combobox").fill("add tr");
  await expect(dialog.getByRole("option").first()).toContainText("Add transfer");
  await dialog.getByRole("combobox").press("Enter");
  // The add request takes over the URL here, so the period bootstrap's `?month=` is not waited on.
  await expect(page).toHaveURL((url) => url.pathname === "/");
  if (isPhone()) {
    await expect(page.getByRole("dialog", { name: "Add transfer" })).toBeVisible();
  } else {
    await expect(page.getByRole("radio", { name: "Transfer" })).toHaveAttribute("aria-checked", "true");
  }
  await expect(page).toHaveURL((url) => !url.searchParams.has("add"));
});

test("Ctrl+K opens the search, Escape closes it", async ({ page }) => {
  test.skip(isPhone(), "No keyboard shortcut on a phone");
  const { user } = await seedUser(uniqueStamp());
  await signInWithPassword(page, user.email);
  await expectDashboardHome(page);
  await page.locator("body").click({ position: { x: 5, y: 200 } });
  await page.keyboard.press("Control+k");
  const dialog = page.getByTestId("search-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("combobox")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("See all lists every match across months on the search page", async ({ page }) => {
  const stamp = uniqueStamp();
  const { user, title, expense } = await seedUser(stamp);
  // Seven more of the same, so the palette's six leave some for the full page.
  await prisma.transaction.createMany({
    data: Array.from({ length: 7 }, (_, i) => ({
      userId: user.id,
      type: TransactionType.EXPENSE,
      amountCents: 100 + i,
      date: new Date(Date.UTC(2024, i, 10)),
      title: `${title} refill ${i}`,
      categoryId: expense.categoryId,
      accountId: expense.accountId,
    })),
  });
  await signInWithPassword(page, user.email);
  await expectDashboardHome(page);

  const dialog = await openSearch(page);
  await dialog.getByRole("combobox").fill(title);
  await dialog.getByRole("option").filter({ hasText: "See all 8 transactions" }).click();

  await expect(page).toHaveURL(/\/search\?q=/);
  await expect(page.getByTestId("search-total")).toContainText("8 transactions");
  await expect(page.getByTestId("search-results").getByRole("link")).toHaveCount(8);

  // By amount, from the page's own form.
  await page.getByRole("searchbox", { name: "Search" }).fill("12.34");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByTestId("search-total")).toContainText("1 transaction");
  await expect(page.getByTestId("search-results")).toContainText(title);
});

test("an amount and a title typed into the search add an expense, with Undo", async ({ page }) => {
  // The same server action on any screen size; the phone layout is covered above.
  test.skip(isPhone());
  const stamp = uniqueStamp();
  const { user } = await seedUser(stamp);
  const word = `bakery${stamp.replace(/[^a-z0-9]/gi, "")}`;
  const category = await prisma.category.create({ data: { userId: user.id, kind: CategoryKind.EXPENSE, name: `Treats ${stamp}` } });
  await prisma.transactionRule.create({
    data: { userId: user.id, priority: 0, titleOperator: "CONTAINS", titlePattern: word, transactionType: "EXPENSE", setCategoryId: category.id },
  });
  await signInWithPassword(page, user.email);
  await expectDashboardHome(page);

  const dialog = await openSearch(page);
  await dialog.getByRole("combobox").fill(`12.50 ${word} yesterday`);
  const offer = dialog.getByRole("option").first();
  await expect(offer).toContainText(`Add expense $12.50 ${word.charAt(0).toUpperCase()}${word.slice(1)}`);
  await expect(offer).toContainText(category.name);
  await dialog.getByRole("combobox").press("Enter");

  await expect(dialog.getByRole("status")).toContainText("Added $12.50");
  const added = await prisma.transaction.findFirstOrThrow({
    where: { userId: user.id, amountCents: 1250 },
    select: { id: true, categoryId: true, needsReview: true, date: true },
  });
  expect(added).toMatchObject({ categoryId: category.id, needsReview: false });

  await dialog.getByRole("button", { name: "Undo" }).click();
  await expect(dialog.getByRole("status")).toContainText("Removed it again");
  expect(await prisma.transaction.count({ where: { id: added.id } })).toBe(0);
});
