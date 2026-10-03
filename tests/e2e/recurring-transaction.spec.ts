import { expect, test } from "@playwright/test";
import { hash } from "bcryptjs";
import { prisma } from "../../src/lib/prisma";
import { dateFromYmd, ymdFromDateUtc } from "../../src/lib/date-only";
import { shiftYm } from "../../src/lib/dashboard-period";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { currentYmInTimeZone } from "../../src/lib/period-month";
import { expectDashboardHome } from "./expect-dashboard-home";
import { expectExpenseInLog, uniqueStamp } from "./helpers";

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

test("desktop: create and post a recurring expense", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop add menu flow is covered by the chromium project");

  const stamp = uniqueStamp();
  const email = `e2e-recurring-${stamp}@example.com`;
  const password = "e2e-password-123";

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hash(password, 12),
      displayName: "E2E Recurring User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);

  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Login" }).click();

  await expectDashboardHome(page);

  await page.getByRole("button", { name: "Add", exact: true }).click();
  const addDialog = page.getByRole("dialog", { name: "Add transaction" });
  await addDialog.getByRole("button", { name: "Recurring" }).click();

  const { nextExpectedDate, nextDuePattern } = recurringExpenseDates();
  const name = `Recurring gym ${stamp}`;
  await addDialog.locator('textarea[name="name"]').fill(name);
  await addDialog.locator('input[name="amount"]').fill("19.99");
  await addDialog.locator('select[name="cadence"]').selectOption("MONTHLY");
  await addDialog.locator('input[name="nextExpectedDate"]').fill(nextExpectedDate);
  await addDialog.getByRole("button", { name: "Add recurring transaction" }).click();
  await addDialog.getByRole("button", { name: "Close" }).click();

  await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 15_000 });

  const recurringPanel = page.getByRole("region", { name: "Recurring transactions" });
  await recurringPanel.getByRole("button", { name: "Post transaction" }).click();

  await expectExpenseInLog(page, name);
  await expect(recurringPanel.getByText(nextDuePattern)).toBeVisible({ timeout: 15_000 });
});

test("an overdue rule from an earlier month can be posted for the current month", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Dashboard flow is covered by the chromium project");

  const stamp = uniqueStamp();
  const email = `e2e-recurring-overdue-${stamp}@example.com`;
  const password = "e2e-password-123";
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hash(password, 12),
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

  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Login" }).click();
  await expectDashboardHome(page);

  const recurringPanel = page.getByRole("region", { name: "Recurring transactions" });
  await expect(recurringPanel.getByText(name, { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(recurringPanel.getByText("Unposted since")).toBeVisible();
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
