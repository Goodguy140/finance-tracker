import { expect, test } from "@playwright/test";
import { prisma } from "../../src/lib/prisma";
import { dateFromYmd, ymdFromDateUtc } from "../../src/lib/date-only";
import { shiftYm } from "../../src/lib/dashboard-period";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { currentYmInTimeZone } from "../../src/lib/period-month";
import { expectDashboardHome } from "./expect-dashboard-home";
import { expectExpenseInLog, hashTestPassword, signInWithPassword, uniqueStamp } from "./helpers";

function recurringExpenseDates(reference = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = reference.getFullYear();
  const monthIndex = reference.getMonth();
  const periodYm = `${year}-${pad(monthIndex + 1)}`;
  const nextExpectedDate = `${periodYm}-16`;
  const afterPost = new Date(year, monthIndex + 1, 16);
  const nextDuePattern = new RegExp(
    `${afterPost.toLocaleString("en-US", { month: "short" })}.*16.*${afterPost.getFullYear()}`,
  );
  return { nextExpectedDate, nextDuePattern };
}

test("desktop: create and post a recurring expense", async ({ page }) => {
  const stamp = uniqueStamp();
  const email = `e2e-recurring-${stamp}@example.com`;
  const password = "e2e-password-123";

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword(password),
      displayName: "E2E Recurring User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);

  await signInWithPassword(page, email, password);

  await expectDashboardHome(page);

  // The header's Add menu is gone; rules are added from the card that manages them.
  await expect(page.getByRole("button", { name: "Add", exact: true })).toHaveCount(0);
  // Scoped to the card: the rule is also listed under Upcoming bills.
  const recurringPanel = page.getByRole("region", { name: "Recurring transactions" });
  await recurringPanel.getByRole("button", { name: "New rule" }).click();
  const addDialog = page.getByRole("dialog", { name: "New recurring transaction" });

  const { nextExpectedDate, nextDuePattern } = recurringExpenseDates();
  const name = `Recurring gym ${stamp}`;
  await addDialog.locator('[name="name"]').fill(name);
  await addDialog.locator('input[name="amount"]').fill("19.99");
  await addDialog.locator('select[name="cadence"]').selectOption("MONTHLY");
  await addDialog.locator('input[name="nextExpectedDate"]').fill(nextExpectedDate);
  await addDialog.getByRole("button", { name: "Add recurring transaction" }).click();
  await expect(addDialog).toHaveCount(0);

  await expect(recurringPanel.getByText(name, { exact: true })).toBeVisible({ timeout: 15_000 });

  await recurringPanel.getByRole("button", { name: "Post transaction" }).click();

  await expectExpenseInLog(page, name);
  await expect(recurringPanel.getByText(nextDuePattern)).toBeVisible({ timeout: 15_000 });
});

test("an overdue rule from an earlier month can be posted for the current month", async ({ page }) => {
  const stamp = uniqueStamp();
  const email = `e2e-recurring-overdue-${stamp}@example.com`;
  const password = "e2e-password-123";
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword(password),
      displayName: "E2E Recurring User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  const account = await prisma.account.findFirstOrThrow({ where: { userId: user.id } });
  const category = await prisma.category.findFirstOrThrow({ where: { userId: user.id, kind: "EXPENSE" } });

  // Left unposted two months ago: the dashboard's default month is the current one.
  const currentYm = currentYmInTimeZone(user.timezone);
  const name = `Overdue gym ${stamp}`;
  const rule = await prisma.recurringTransaction.create({
    data: {
      userId: user.id,
      accountId: account.id,
      categoryId: category.id,
      type: "EXPENSE",
      name,
      amountCents: 1999,
      cadence: "MONTHLY",
      nextExpectedDate: dateFromYmd(`${shiftYm(currentYm, -2)}-10`),
    },
  });

  await signInWithPassword(page, email, password);
  await expectDashboardHome(page);

  const recurringPanel = page.getByRole("region", { name: "Recurring transactions" });
  await expect(recurringPanel.getByText(name, { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(recurringPanel.getByText("Unposted since")).toBeVisible();

  // Upcoming bills lists it once this month, carried past the missed ones. Next month's
  // occurrence also falls inside the 30-day window once this month's day has passed.
  const upcoming = page.getByRole("region", { name: "Upcoming bills" });
  const listedIn = (ym: string) => upcoming.locator(`[data-forecast-day^="${ym}-"]`).getByText(name, { exact: true });
  await expect(listedIn(currentYm)).toHaveCount(1);
  await expect(listedIn(shiftYm(currentYm, -1))).toHaveCount(0);
  await expect(listedIn(shiftYm(currentYm, -2))).toHaveCount(0);
  await expect(upcoming.getByText(/Unposted since/)).toBeVisible();
  await recurringPanel.getByRole("button", { name: "Post transaction" }).click();

  const thisMonthYmd = `${currentYm}-10`;
  await expect
    .poll(
      async () => {
        const txn = await prisma.transaction.findFirst({ where: { recurringTransactionId: rule.id } });
        return txn ? ymdFromDateUtc(txn.date) : null;
      },
      { timeout: 15_000 },
    )
    .toBe(thisMonthYmd);
  const advanced = await prisma.recurringTransaction.findUniqueOrThrow({ where: { id: rule.id } });
  expect(ymdFromDateUtc(advanced.nextExpectedDate)).toBe(`${shiftYm(currentYm, 1)}-10`);
});

test("desktop: edit a recurring rule from the Recurring card", async ({ page }) => {
  const stamp = uniqueStamp();
  const email = `e2e-recurring-edit-${stamp}@example.com`;
  const password = "e2e-password-123";
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword(password),
      displayName: "E2E Recurring User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  const account = await prisma.account.findFirstOrThrow({ where: { userId: user.id } });
  const category = await prisma.category.findFirstOrThrow({ where: { userId: user.id, kind: "EXPENSE" } });

  // Overdue from last month, so it shows in the current month whatever today's date is.
  const currentYm = currentYmInTimeZone(user.timezone);
  const name = `Editable gym ${stamp}`;
  const rule = await prisma.recurringTransaction.create({
    data: {
      userId: user.id,
      accountId: account.id,
      categoryId: category.id,
      type: "EXPENSE",
      name,
      amountCents: 1999,
      cadence: "MONTHLY",
      nextExpectedDate: dateFromYmd(`${shiftYm(currentYm, -1)}-10`),
    },
  });

  await signInWithPassword(page, email, password);
  await expectDashboardHome(page);

  const recurringPanel = page.getByRole("region", { name: "Recurring transactions" });
  await expect(recurringPanel.getByText(name, { exact: true })).toBeVisible({ timeout: 15_000 });
  await recurringPanel.getByRole("button", { name: `More actions for ${name}` }).click();
  await recurringPanel.getByRole("button", { name: "Edit", exact: true }).click();

  // The shared form opens filled with the rule as stored.
  const dialog = page.getByRole("dialog", { name: "Edit recurring transaction" });
  const amount = dialog.getByLabel("Amount each time");
  await expect(amount).toHaveValue("19.99");
  await expect(dialog.getByLabel("Category")).toHaveValue(category.id);
  await amount.fill("25.50");
  await dialog.getByLabel("Note").fill("Price went up");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toHaveCount(0);

  await expect
    .poll(
      async () => {
        const row = await prisma.recurringTransaction.findUnique({ where: { id: rule.id } });
        return row ? { amountCents: row.amountCents, note: row.note, categoryId: row.categoryId, type: row.type } : null;
      },
      { timeout: 10_000 },
    )
    .toEqual({ amountCents: 2550, note: "Price went up", categoryId: category.id, type: "EXPENSE" });
});
