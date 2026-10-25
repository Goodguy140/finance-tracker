import { expect, test } from "@playwright/test";
import { CategoryKind, TransactionType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { currentYmInTimeZone } from "../../src/lib/period-month";
import { expectDashboardHome } from "./expect-dashboard-home";
import { expenseLogLocator, hashTestPassword, signInWithPassword, uniqueStamp } from "./helpers";

const isPhone = () => test.info().project.name === "mobile-chromium";

test("the calendar shows a day's spending and opens the log on that day", async ({ page }) => {
  const stamp = uniqueStamp().replace(/[^a-z0-9]/gi, "");
  const email = `e2e-calendar-${stamp}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword("e2e-password-123"),
      displayName: "E2E Calendar User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  const category = await prisma.category.findFirstOrThrow({ where: { userId: user.id, kind: CategoryKind.EXPENSE } });
  const account = await prisma.account.findFirstOrThrow({ where: { userId: user.id } });
  const ym = currentYmInTimeZone(user.timezone);
  const add = (title: string, day: string, amountCents: number) =>
    prisma.transaction.create({
      data: {
        userId: user.id,
        type: TransactionType.EXPENSE,
        amountCents,
        date: new Date(`${ym}-${day}T00:00:00Z`),
        title,
        categoryId: category.id,
        accountId: account.id,
      },
    });
  await add(`Bakery ${stamp}`, "12", 2_500);
  await add(`Books ${stamp}`, "12", 1_000);
  await add(`Other day ${stamp}`, "14", 9_900);

  await signInWithPassword(page, email, "e2e-password-123");
  await expectDashboardHome(page);
  if (!isPhone()) await page.getByRole("tab", { name: "Calendar" }).click();
  const day = page.locator(`[data-calendar-day="${ym}-12"]`).filter({ visible: true });
  await expect(day).toContainText("$35");

  await day.click();
  await expect(page).toHaveURL(new RegExp(`range=custom&from=${ym}-12&to=${ym}-12`));
  const log = expenseLogLocator(page);
  await expect(log.getByText(`Bakery ${stamp}`).filter({ visible: true })).toHaveCount(1);
  await expect(log.getByText(`Other day ${stamp}`).filter({ visible: true })).toHaveCount(0);
});
