import { expect, test, type Page } from "@playwright/test";
import { hash } from "bcryptjs";
import { prisma } from "../../src/lib/prisma";
import { dateFromYmd } from "../../src/lib/date-only";
import { shiftYm } from "../../src/lib/dashboard-period";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { currentYmInTimeZone } from "../../src/lib/period-month";
import { expectDashboardHome } from "./expect-dashboard-home";
import { uniqueStamp } from "./helpers";

// The Add card is desktop-only (phones add through the quick-add buttons), and the Recurring
// card's controls are the same on both, so these run once on desktop.
const DESKTOP_ONLY = "The Add card only renders above lg; the Recurring card is the same on both";

async function signIn(page: Page, label: string) {
  const stamp = uniqueStamp();
  const email = `e2e-card-actions-${label}-${stamp}@example.com`;
  const password = "e2e-password-123";
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hash(password, 12),
      displayName: "E2E Card Actions User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Login" }).click();
  await expectDashboardHome(page);
  return { user, stamp };
}

async function createRule(userId: string, name: string, nextExpectedYmd: string) {
  const account = await prisma.account.findFirstOrThrow({ where: { userId } });
  const category = await prisma.category.findFirstOrThrow({ where: { userId, kind: "EXPENSE" } });
  return prisma.recurringTransaction.create({
    data: {
      userId,
      accountId: account.id,
      categoryId: category.id,
      type: "EXPENSE",
      name,
      amountCents: 1500,
      cadence: "MONTHLY",
      nextExpectedDate: dateFromYmd(nextExpectedYmd),
    },
  });
}

test("income is added from the Add card", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", DESKTOP_ONLY);
  const { user, stamp } = await signIn(page, "income");

  const card = page.getByRole("region", { name: "Add", exact: true });
  await card.getByRole("radio", { name: "Income" }).click();
  const title = `Card paycheque ${stamp}`;
  await card.getByLabel("Amount").fill("1234.56");
  await card.locator('textarea[name="title"]').fill(title);
  await card.getByRole("button", { name: "Add income" }).click();

  await expect
    .poll(async () => {
      const row = await prisma.transaction.findFirst({ where: { userId: user.id, title } });
      return row ? { type: row.type, amountCents: row.amountCents } : null;
    })
    .toEqual({ type: "INCOME", amountCents: 123456 });
});

test("a rule is added from the Recurring card's New rule button", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", DESKTOP_ONLY);
  const { user, stamp } = await signIn(page, "new-rule");

  const recurring = page.getByRole("region", { name: "Recurring transactions" });
  await recurring.getByRole("button", { name: "New rule" }).click();
  const dialog = page.getByRole("dialog", { name: "New recurring transaction" });
  const name = `Card gym ${stamp}`;
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Amount each time").fill("42.00");
  await dialog.getByRole("button", { name: "Add recurring transaction" }).click();
  await expect(dialog).toHaveCount(0);

  await expect
    .poll(async () => {
      const row = await prisma.recurringTransaction.findFirst({ where: { userId: user.id, name } });
      return row ? { amountCents: row.amountCents, cadence: row.cadence } : null;
    })
    .toEqual({ amountCents: 4200, cadence: "MONTHLY" });
  await expect(recurring.getByText(name, { exact: true })).toBeVisible();
});

test("removing a rule asks first, and Keep leaves it alone", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", DESKTOP_ONLY);
  const { user, stamp } = await signIn(page, "remove");
  // Overdue from last month, so the current month shows it whatever today's date is.
  const currentYm = currentYmInTimeZone("America/Toronto");
  const name = `Removable ${stamp}`;
  const rule = await createRule(user.id, name, `${shiftYm(currentYm, -1)}-10`);
  await page.reload();
  await expectDashboardHome(page);

  const recurring = page.getByRole("region", { name: "Recurring transactions" });
  await expect(recurring.getByText(name, { exact: true })).toBeVisible();

  await recurring.getByRole("button", { name: "Remove", exact: true }).click();
  const confirm = recurring.getByRole("group", { name: `Remove ${name}?` });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Keep" }).click();
  await expect(confirm).toHaveCount(0);
  expect(await prisma.recurringTransaction.count({ where: { id: rule.id } })).toBe(1);

  await recurring.getByRole("button", { name: "Remove", exact: true }).click();
  await recurring.getByRole("button", { name: "Remove rule" }).click();
  await expect.poll(() => prisma.recurringTransaction.count({ where: { id: rule.id } })).toBe(0);
});

test("rules outside the month on screen can be shown and edited", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", DESKTOP_ONLY);
  const { user, stamp } = await signIn(page, "others");
  const currentYm = currentYmInTimeZone("America/Toronto");
  const name = `Next quarter ${stamp}`;
  await createRule(user.id, name, `${shiftYm(currentYm, 3)}-05`);
  await page.reload();
  await expectDashboardHome(page);

  const recurring = page.getByRole("region", { name: "Recurring transactions" });
  // Starting position: the month filter keeps it off the card.
  await expect(recurring.getByText(name, { exact: true })).toHaveCount(0);
  await recurring.getByRole("button", { name: "show it" }).click();
  await expect(recurring.getByText("Other months")).toBeVisible();
  await expect(recurring.getByText(name, { exact: true })).toBeVisible();
  await recurring.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Edit recurring transaction" }).getByLabel("Name")).toHaveValue(name);
});
