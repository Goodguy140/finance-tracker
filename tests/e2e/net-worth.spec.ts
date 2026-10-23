import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { AccountType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { expectDashboardHome } from "./expect-dashboard-home";
import { hashTestPassword, signInWithPassword, uniqueStamp } from "./helpers";

/** The 15th of the month `monthsBack` before this one, as a stored date-only value. */
function midMonthsAgo(monthsBack: number) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 15));
}

const SCREENSHOT_DIR = process.env.E2E_SCREENSHOT_DIR;

test("net worth charts balances less what is owed, and a balance can be entered by hand and deleted", async ({ page }, testInfo) => {
  const email = `e2e-net-worth-${uniqueStamp()}@example.com`;
  const password = "e2e-password-123";
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword(password),
      displayName: "E2E Net Worth User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  const [chequing, card] = await Promise.all([
    prisma.account.findFirstOrThrow({ where: { userId: user.id, type: AccountType.CHEQUING } }),
    prisma.account.findFirstOrThrow({ where: { userId: user.id, type: AccountType.CREDIT_CARD } }),
  ]);
  const [tfsa, mortgage] = await Promise.all([
    prisma.account.create({ data: { userId: user.id, name: "TFSA", type: AccountType.TFSA } }),
    prisma.account.create({ data: { userId: user.id, name: "Mortgage", type: AccountType.LOAN } }),
  ]);
  await prisma.accountBalanceSnapshot.createMany({
    data: [
      { userId: user.id, accountId: chequing.id, date: midMonthsAgo(3), balanceCents: 400_000, source: "PLAID" },
      { userId: user.id, accountId: chequing.id, date: midMonthsAgo(1), balanceCents: 500_000, source: "PLAID" },
      { userId: user.id, accountId: card.id, date: midMonthsAgo(1), balanceCents: 80_000, source: "PLAID" },
    ],
  });
  // An investment snapshot counts toward net worth too.
  await prisma.portfolioSnapshot.create({
    data: { userId: user.id, accountId: tfsa.id, date: midMonthsAgo(2), totalValueCents: 2_000_000 },
  });

  await signInWithPassword(page, email, password);
  await expectDashboardHome(page);

  await page.goto("/reports");
  const section = page.getByTestId("report-net-worth");
  // $5,000 + $20,000 − $800; the mortgage has no balance yet and is left out.
  await expect(section).toContainText("$24,200.00");
  await expect(page.getByTestId("net-worth-chart")).toBeVisible();

  // Enter the mortgage by hand.
  // Balances live on each account, in the drawer the account row opens.
  await page.goto("/settings/accounts");
  const accounts = page.getByTestId("account-list");
  await accounts.getByRole("button", { name: "Edit Mortgage" }).click();
  const dialog = page.getByRole("dialog", { name: "Mortgage" });
  const balance = dialog.getByTestId("account-balance");
  await balance.getByLabel("Amount owed").fill("300000");
  if (SCREENSHOT_DIR) {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await dialog.screenshot({ path: `${SCREENSHOT_DIR}/balances-${testInfo.project.name}.png` });
  }
  await balance.getByRole("button", { name: "Save balance" }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(async () => (await prisma.accountBalanceSnapshot.findFirst({ where: { accountId: mortgage.id } }))?.balanceCents ?? null)
    .toBe(30_000_000);
  await expect(accounts.getByRole("button", { name: "Edit Mortgage" })).toContainText("Owes $300,000.00");

  await page.goto("/reports");
  await expect(section).toContainText("-$275,800.00");
  if (SCREENSHOT_DIR) {
    await section.getByText("By account").click();
    await section.screenshot({ path: `${SCREENSHOT_DIR}/reports-${testInfo.project.name}.png` });
  }

  // A balance entered by hand can be deleted again, after an in-page confirm.
  await page.goto("/settings/accounts");
  await accounts.getByRole("button", { name: "Edit Mortgage" }).click();
  const entries = dialog.getByTestId("manual-balances");
  await expect(entries.getByRole("listitem")).toHaveCount(1);
  await entries.getByRole("button", { name: /^Delete balance from / }).click();
  const confirm = page.getByRole("dialog", { name: "Delete this balance?" });
  await expect(confirm).toContainText("$300,000.00");
  if (SCREENSHOT_DIR) {
    await page.screenshot({ path: `${SCREENSHOT_DIR}/delete-balance-${testInfo.project.name}.png` });
  }
  await confirm.getByRole("button", { name: "Delete balance" }).click();
  await expect.poll(() => prisma.accountBalanceSnapshot.count({ where: { accountId: mortgage.id } })).toBe(0);
  await expect(entries).toBeHidden();
  // Bank-synced balances are not listed, so they cannot be deleted.
  await dialog.getByRole("button", { name: "Close" }).click();
  await accounts.getByRole("button", { name: "Edit Main Chequing" }).click();
  await expect(page.getByRole("dialog").getByTestId("account-balance")).toBeVisible();
  await expect(page.getByTestId("manual-balances")).toHaveCount(0);

  await page.goto("/reports");
  await expect(section).toContainText("$24,200.00");
});
