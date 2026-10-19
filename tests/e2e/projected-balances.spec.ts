import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { hash } from "bcryptjs";
import { AccountType, CategoryKind } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { dateFromYmd, ymdFromDateUtc } from "../../src/lib/date-only";
import { currentYmdInTimeZone } from "../../src/lib/period-month";
import { expectDashboardHome } from "./expect-dashboard-home";
import { uniqueStamp } from "./helpers";

const SCREENSHOT_DIR = process.env.E2E_SCREENSHOT_DIR;
const TIMEZONE = "America/Toronto";

test("projected balances apply upcoming bills to the account they book to", async ({ page }, testInfo) => {
  const email = `e2e-projected-${uniqueStamp()}@example.com`;
  const password = "e2e-password-123";
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hash(password, 12),
      displayName: "E2E Projection User",
      countryCode: "CA",
      timezone: TIMEZONE,
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  const [chequing, category] = await Promise.all([
    prisma.account.findFirstOrThrow({ where: { userId: user.id, type: AccountType.CHEQUING } }),
    prisma.category.findFirstOrThrow({ where: { userId: user.id, kind: CategoryKind.EXPENSE } }),
  ]);
  const today = dateFromYmd(currentYmdInTimeZone(TIMEZONE));
  const inFiveDays = new Date(today.getTime() + 5 * 24 * 60 * 60 * 1000);
  await prisma.accountBalanceSnapshot.create({
    data: { userId: user.id, accountId: chequing.id, date: today, balanceCents: 150_000, source: "MANUAL" },
  });
  // Monthly from five days out: once within 30 days, twice within 60, three times within 90.
  await prisma.recurringTransaction.create({
    data: {
      userId: user.id,
      accountId: chequing.id,
      categoryId: category.id,
      type: "EXPENSE",
      name: "Rent",
      amountCents: 100_000,
      cadence: "MONTHLY",
      nextExpectedDate: inFiveDays,
      anchorDay: inFiveDays.getUTCDate(),
    },
  });

  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Login" }).click();
  await expectDashboardHome(page);

  await page.goto("/reports");
  const section = page.getByTestId("report-projected-balances");
  const tiles = section.getByTestId("projected-net-worth");
  await expect(tiles).toContainText("$1,500.00");
  await expect(tiles).toContainText("$500.00");
  await expect(tiles).toContainText("-$500.00");
  await expect(tiles).toContainText("-$1,500.00");
  await expect(section.getByTestId("projected-below-zero")).toContainText(`${chequing.name} goes below zero`);

  await section.getByText("By account").click();
  const row = section.getByTestId("projected-accounts").getByRole("row", { name: new RegExp(chequing.name) });
  await expect(row.getByRole("cell")).toHaveText(["$1,500.00", "$500.00", "-$500.00", "-$1,500.00"]);

  if (SCREENSHOT_DIR) {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await section.screenshot({ path: `${SCREENSHOT_DIR}/projected-${testInfo.project.name}.png` });
  }
});

test("a recurring transfer moves money between accounts in the projection once included", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "The form and the projection are the same on a phone");
  const email = `e2e-projected-transfer-${uniqueStamp()}@example.com`;
  const password = "e2e-password-123";
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hash(password, 12),
      displayName: "E2E Projection Transfer User",
      countryCode: "CA",
      timezone: TIMEZONE,
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  const [chequing, card] = await Promise.all([
    prisma.account.findFirstOrThrow({ where: { userId: user.id, type: AccountType.CHEQUING } }),
    prisma.account.findFirstOrThrow({ where: { userId: user.id, type: AccountType.CREDIT_CARD } }),
  ]);
  const todayYmd = currentYmdInTimeZone(TIMEZONE);
  const today = dateFromYmd(todayYmd);
  const inFiveDays = new Date(today.getTime() + 5 * 24 * 60 * 60 * 1000);
  await prisma.accountBalanceSnapshot.createMany({
    data: [
      { userId: user.id, accountId: chequing.id, date: today, balanceCents: 150_000, source: "MANUAL" },
      // What is owed on the card.
      { userId: user.id, accountId: card.id, date: today, balanceCents: 100_000, source: "MANUAL" },
    ],
  });

  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Login" }).click();
  await expectDashboardHome(page);

  // Monthly from five days out: once within 30 days, twice within 60, three times within 90.
  const recurring = page.getByRole("region", { name: "Recurring transactions" });
  await recurring.getByRole("button", { name: "New rule" }).click();
  const dialog = page.getByRole("dialog", { name: "New recurring transaction" });
  await dialog.getByLabel("Name").fill("Card payment");
  await dialog.getByLabel("Type").selectOption("TRANSFER");
  await expect(dialog.getByLabel("Category")).toHaveCount(0);
  await dialog.getByLabel("From account").selectOption(chequing.id);
  await dialog.getByLabel("To account").selectOption(card.id);
  await dialog.getByLabel("Amount each time").fill("200.00");
  await dialog.locator('input[name="nextExpectedDate"]').fill(ymdFromDateUtc(inFiveDays));
  await dialog.getByRole("button", { name: "Add recurring transaction" }).click();
  await expect(dialog).toHaveCount(0);
  const rule = await prisma.recurringTransaction.findFirstOrThrow({ where: { userId: user.id, name: "Card payment" } });
  expect(rule).toMatchObject({ type: "TRANSFER", accountId: chequing.id, transferAccountId: card.id, amountCents: 20_000 });

  await page.goto("/reports");
  const section = page.getByTestId("report-projected-balances");
  await section.getByText("By account").click();
  const accounts = section.getByTestId("projected-accounts");
  const chequingCells = accounts.getByRole("row", { name: new RegExp(chequing.name) }).getByRole("cell");
  const cardCells = accounts.getByRole("row", { name: new RegExp(card.name) }).getByRole("cell");
  // Off by default: nothing moves.
  await expect(chequingCells).toHaveText(["$1,500.00", "$1,500.00", "$1,500.00", "$1,500.00"]);
  await expect(cardCells).toHaveText(["−$1,000.00", "−$1,000.00", "−$1,000.00", "−$1,000.00"]);

  await section.getByTestId("projected-include-transfers").check();
  await expect(chequingCells).toHaveText(["$1,500.00", "$1,300.00", "$1,100.00", "$900.00"]);
  // Each payment lowers what is owed on the card as much as it lowers chequing.
  await expect(cardCells).toHaveText(["−$1,000.00", "−$800.00", "−$600.00", "−$400.00"]);
  // Money moved between the user's own accounts leaves net worth where it was.
  const tiles = section.getByTestId("projected-net-worth");
  await expect(tiles).not.toContainText("−");
  await expect(tiles.getByText("$500.00", { exact: true })).toHaveCount(4);
  await expect.poll(async () => (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).projectionIncludesTransfers).toBe(true);

  // Saved for next time.
  await page.reload();
  await expect(page.getByTestId("projected-include-transfers")).toBeChecked();

  if (SCREENSHOT_DIR) {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.getByTestId("report-projected-balances").getByText("By account").click();
    await page.getByTestId("report-projected-balances").screenshot({ path: `${SCREENSHOT_DIR}/projected-transfers-${testInfo.project.name}.png` });
  }
});
