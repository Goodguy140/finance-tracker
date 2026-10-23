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
  await expectDashboardHome(page);
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
