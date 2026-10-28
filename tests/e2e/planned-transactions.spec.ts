import { expect, test } from "@playwright/test";
import { CategoryKind, TransactionType } from "@prisma/client";
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

test("a planned one-off shows in Upcoming bills, and one past its date can be added to the log", async ({ page }) => {
  const stamp = uniqueStamp().replace(/[^a-z0-9]/gi, "");
  const user = await prisma.user.create({
    data: {
      email: `e2e-planned-${stamp}@example.com`,
      passwordHash: await hashTestPassword(),
      displayName: "E2E Planned User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  const category = await prisma.category.findFirstOrThrow({ where: { userId: user.id, kind: CategoryKind.EXPENSE } });
  const account = await prisma.account.findFirstOrThrow({ where: { userId: user.id } });
  const todayYmd = currentYmdInTimeZone(user.timezone);
  const pastDue = await prisma.plannedTransaction.create({
    data: {
      userId: user.id,
      accountId: account.id,
      categoryId: category.id,
      type: TransactionType.EXPENSE,
      name: `Gift ${stamp}`,
      amountCents: 4_500,
      date: dateFromYmd(shiftYmd(todayYmd, -2)),
    },
  });

  await signInWithPassword(page, user.email, TEST_PASSWORD);
  await expectDashboardHome(page);
  const bills = page.locator('[data-card-id="bills-forecast"]').filter({ visible: true });

  // Planned on the Add card's Plan tab.
  const add = page.locator('[data-card-id="add-expense"]').filter({ visible: true });
  await add.getByRole("radio", { name: "Plan" }).click();
  await add.getByLabel("What", { exact: true }).fill(`Winter tires ${stamp}`);
  await add.getByLabel("Amount").fill("600");
  await add.getByLabel("Expected on").fill(shiftYmd(todayYmd, 10));
  await add.getByRole("button", { name: "Add plan" }).click();
  const row = bills.locator("[data-forecast-day] li", { hasText: `Winter tires ${stamp}` });
  await expect(row).toContainText("Planned");
  await expect(row).toContainText("$600.00");

  // "Did this happen?" → added to the log on its date, and the plan is done.
  const prompt = bills.locator("[data-planned-past-due]");
  await expect(prompt).toContainText(`Gift ${stamp}`);
  await prompt.getByRole("button", { name: "Yes, add it" }).click();
  await expect(prompt).toHaveCount(0);
  await expect
    .poll(async () => (await prisma.plannedTransaction.findUniqueOrThrow({ where: { id: pastDue.id } })).transactionId)
    .not.toBeNull();
  const entry = await prisma.transaction.findFirstOrThrow({ where: { userId: user.id, title: `Gift ${stamp}` } });
  expect(entry.amountCents).toBe(4_500);
  expect(ymdFromDateUtc(entry.date)).toBe(shiftYmd(todayYmd, -2));
});
