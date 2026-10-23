import { randomBytes } from "crypto";
import { hash } from "bcryptjs";
import { expect, type Page } from "@playwright/test";

let stampSequence = 0;

export const TEST_PASSWORD = "e2e-password-123";

/**
 * bcrypt at the minimum cost. Production's cost 12 takes ~0.4s per hash, and checking a
 * password costs whatever hashing it did, so every seeded user paid that twice: once here and
 * once more on the server at each sign-in. Nothing in the suite depends on the cost.
 */
export function hashTestPassword(password: string = TEST_PASSWORD): Promise<string> {
  return hash(password, 4);
}

/** Fills and submits the login form. Callers assert where it lands (dashboard, /mfa, an error). */
export async function signInWithPassword(page: Page, email: string, password: string = TEST_PASSWORD) {
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Login", exact: true }).click();
}

/**
 * A suffix that makes a test-scoped identifier — an email, an expense title, a Plaid id —
 * unique across the whole suite.
 *
 * `Date.now()` on its own is not: a spec in MOBILE_SPECS (playwright.config.ts) runs under
 * both the chromium and mobile-chromium projects, in parallel workers, so two copies of the
 * same `createUser` can land in one millisecond and collide on `User.email`'s unique index. The retry then
 * collides again, this time with the row the first attempt left behind.
 *
 * So the timestamp only orders things for a human reading the database; the pid separates
 * concurrent workers, the counter separates calls within a worker, and the random tail
 * separates a retry from the attempt before it (a retry runs in a fresh worker process,
 * but nothing guarantees it a different pid).
 */
export function uniqueStamp(): string {
  stampSequence += 1;
  return `${Date.now()}-${process.pid}-${stampSequence}-${randomBytes(4).toString("hex")}`;
}

/**
 * Every dashboard card is a labelled region, so locate by role rather than by climbing out of
 * a heading — the card shell owns the heading now, and its depth is no longer the spec's
 * business.
 */
export function expenseLogLocator(page: Page) {
  return page.getByRole("region", { name: "Expense Log" });
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

/** Backup, restore and the danger zone, which used to be the Advanced tab. */
export async function openSettingsAdvancedTab(page: Page) {
  await page.goto("/settings/backup");
  await expect(page.getByRole("region", { name: "Backup & export" })).toBeVisible();
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
    const section = page.getByRole("region", { name: "Add", exact: true });
    await section.getByPlaceholder("e.g. Weekly groceries, Shell fuel").fill(title);
    await section.locator('input[name="amount"]').fill(amount);
    // Exact: every card header carries a settings button named "<card> settings", which a
    // substring match on "Add expense" would also hit.
    await section.getByRole("button", { name: "Add expense", exact: true }).click();
  }
  await expectExpenseInLog(page, title);
}
