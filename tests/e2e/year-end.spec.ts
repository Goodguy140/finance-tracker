import { expect, test } from "@playwright/test";
import { CategoryKind, TransactionType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { tagNameKey } from "../../src/lib/tags";
import { expectDashboardHome } from "./expect-dashboard-home";
import { hashTestPassword, signInWithPassword, uniqueStamp } from "./helpers";

test("the year-end summary totals last year and each tag, tax-looking tags first", async ({ page }) => {
  const stamp = uniqueStamp().replace(/[^a-z0-9]/gi, "");
  const email = `e2e-year-${stamp}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword("e2e-password-123"),
      displayName: "E2E Year User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  const account = await prisma.account.findFirstOrThrow({ where: { userId: user.id } });
  const category = await prisma.category.findFirstOrThrow({ where: { userId: user.id, kind: CategoryKind.EXPENSE } });
  const lastYear = new Date().getUTCFullYear() - 1;
  const [donation, trip] = await Promise.all(
    [`Donation ${stamp}`, `Trip ${stamp}`].map((name) =>
      prisma.tag.create({ data: { userId: user.id, name, nameKey: tagNameKey(name) } }),
    ),
  );
  const spend = (title: string, amountCents: number, tagId: string, month: number) =>
    prisma.transaction.create({
      data: {
        userId: user.id,
        accountId: account.id,
        categoryId: category.id,
        type: TransactionType.EXPENSE,
        amountCents,
        title,
        date: new Date(Date.UTC(lastYear, month, 10)),
        tags: { create: { tagId } },
      },
    });
  await spend("Red Cross", 12_500, donation.id, 2);
  await spend("Flights", 80_000, trip.id, 6);

  await signInWithPassword(page, email, "e2e-password-123");
  await expectDashboardHome(page);
  await page.goto("/reports");
  await page.getByTestId("reports-year-link").click();
  // Last year is the default once there is one: it is the one a tax return is for.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${lastYear} in review`);
  await expect(page.getByTestId("year-totals")).toContainText("Spending$925.00");
  const rows = page.getByTestId("year-tags").locator("tbody tr");
  await expect(rows.nth(0)).toContainText(`Donation ${stamp}`);
  await expect(rows.nth(0)).toContainText("Tax time");
  await expect(rows.nth(0)).toContainText("$125.00");
  await expect(rows.nth(1)).toContainText(`Trip ${stamp}`);
  await expect(rows.nth(1)).not.toContainText("Tax time");
});
