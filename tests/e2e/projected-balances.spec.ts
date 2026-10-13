import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { hash } from "bcryptjs";
import { AccountType, CategoryKind } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { dateFromYmd } from "../../src/lib/date-only";
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
