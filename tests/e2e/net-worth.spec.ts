import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { hash } from "bcryptjs";
import { AccountType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { expectDashboardHome } from "./expect-dashboard-home";
import { uniqueStamp } from "./helpers";

/** The 15th of the month `monthsBack` before this one, as a stored date-only value. */
function midMonthsAgo(monthsBack: number) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 15));
}

const SCREENSHOT_DIR = process.env.E2E_SCREENSHOT_DIR;

test("net worth charts balances less what is owed, and a balance can be entered by hand", async ({ page }, testInfo) => {
  const email = `e2e-net-worth-${uniqueStamp()}@example.com`;
  const password = "e2e-password-123";
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hash(password, 12),
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

  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Login" }).click();
  await expectDashboardHome(page);

  await page.goto("/reports");
  const section = page.getByTestId("report-net-worth");
  // $5,000 + $20,000 − $800; the mortgage has no balance yet and is left out.
  await expect(section).toContainText("$24,200.00");
  await expect(page.getByTestId("net-worth-chart")).toBeVisible();

  // Enter the mortgage by hand.
  await page.goto("/settings#balances");
  const balances = page.getByTestId("account-balances");
  await balances.getByRole("button", { name: "Update balance for Mortgage" }).click();
  const dialog = page.getByRole("dialog", { name: "Balance for Mortgage" });
  await dialog.getByLabel(/Amount owed/).fill("300000");
  await dialog.getByRole("button", { name: "Save balance" }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(async () => (await prisma.accountBalanceSnapshot.findFirst({ where: { accountId: mortgage.id } }))?.balanceCents ?? null)
    .toBe(30_000_000);
  await expect(balances).toContainText("Owes $300,000.00");
  if (SCREENSHOT_DIR) {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.locator("#balances").screenshot({ path: `${SCREENSHOT_DIR}/balances-${testInfo.project.name}.png` });
  }

  await page.goto("/reports");
  await expect(section).toContainText("-$275,800.00");
  if (SCREENSHOT_DIR) {
    await section.getByText("By account").click();
    await section.screenshot({ path: `${SCREENSHOT_DIR}/reports-${testInfo.project.name}.png` });
  }
});
