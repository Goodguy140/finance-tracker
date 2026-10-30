import { expect, test } from "@playwright/test";
import { AccountType, CategoryKind, TransactionType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { dateFromYmd, ymdFromDateUtc } from "../../src/lib/date-only";
import { currentYmdInTimeZone } from "../../src/lib/period-month";
import { expectDashboardHome } from "./expect-dashboard-home";
import { hashTestPassword, signInWithPassword, TEST_PASSWORD, uniqueStamp } from "./helpers";

const shiftYmd = (ymd: string, days: number) => {
  const d = dateFromYmd(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return ymdFromDateUtc(d);
};

test("Upcoming bills lists card payments and recurring transfers outside the totals", async ({ page }) => {
  const stamp = uniqueStamp().replace(/[^a-z0-9]/gi, "");
  const user = await prisma.user.create({
    data: {
      email: `e2e-upcoming-moves-${stamp}@example.com`,
      passwordHash: await hashTestPassword(),
      displayName: "E2E Upcoming Moves User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  const category = await prisma.category.findFirstOrThrow({ where: { userId: user.id, kind: CategoryKind.EXPENSE } });
  const chequing = await prisma.account.findFirstOrThrow({ where: { userId: user.id, type: AccountType.CHEQUING } });
  const todayYmd = currentYmdInTimeZone(user.timezone);
  const inDays = (days: number) => dateFromYmd(shiftYmd(todayYmd, days));
  const card = await prisma.account.create({
    data: {
      userId: user.id,
      name: `Visa ${stamp}`,
      type: AccountType.CREDIT_CARD,
      paymentDueDay: inDays(3).getUTCDate(),
      minimumPaymentCents: 2_500,
    },
  });
  await prisma.accountBalanceSnapshot.create({
    data: { userId: user.id, accountId: card.id, date: inDays(-1), balanceCents: 40_000, source: "MANUAL" },
  });
  const savings = await prisma.account.create({ data: { userId: user.id, name: `Savings ${stamp}`, type: AccountType.SAVINGS } });
  const rule = (name: string, type: TransactionType, amountCents: number, days: number, transferAccountId?: string) =>
    prisma.recurringTransaction.create({
      data: {
        userId: user.id,
        accountId: chequing.id,
        categoryId: category.id,
        type,
        name,
        amountCents,
        cadence: "MONTHLY",
        nextExpectedDate: inDays(days),
        transferAccountId,
      },
    });
  await rule(`Phone ${stamp}`, TransactionType.EXPENSE, 5_000, 5);
  await rule(`To savings ${stamp}`, TransactionType.TRANSFER, 30_000, 7, savings.id);

  await signInWithPassword(page, user.email, TEST_PASSWORD);
  await expectDashboardHome(page);
  const bills = page.locator('[data-card-id="bills-forecast"]').filter({ visible: true });

  const cardRow = bills.locator("[data-forecast-day] li", { hasText: `Visa ${stamp} payment` });
  await expect(cardRow).toContainText("Card payment");
  await expect(cardRow).toContainText("Balance owed, minimum $25.00");
  await expect(cardRow).toContainText("$400.00");

  const transferRow = bills.locator("[data-forecast-day] li", { hasText: `To savings ${stamp}` });
  await expect(transferRow).toContainText("Transfer");
  await expect(transferRow).toContainText(`Main Chequing to Savings ${stamp}`);

  // Only the phone bill counts: the transfer and the card payment move money between accounts.
  await expect(bills.getByText("Bills due").locator("..")).toContainText("$50.00");
  await expect(bills.getByText(/listed but left out of the\s+totals/)).toBeVisible();
});
