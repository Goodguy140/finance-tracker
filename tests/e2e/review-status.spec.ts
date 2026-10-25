import { expect, test } from "@playwright/test";
import { CategoryKind, TransactionType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { expectDashboardHome } from "./expect-dashboard-home";
import { expenseLogLocator, hashTestPassword, signInWithPassword, uniqueStamp } from "./helpers";

test("imported expenses wait under Needs review until marked reviewed", async ({ page }) => {
  const stamp = uniqueStamp().replace(/[^a-z0-9]/gi, "");
  const email = `e2e-review-${stamp}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword("e2e-password-123"),
      displayName: "E2E Review User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  const category = await prisma.category.findFirstOrThrow({ where: { userId: user.id, kind: CategoryKind.EXPENSE } });
  const account = await prisma.account.findFirstOrThrow({ where: { userId: user.id } });
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15));
  const make = (title: string, needsReview: boolean) =>
    prisma.transaction.create({
      data: { userId: user.id, type: TransactionType.EXPENSE, amountCents: 1_500, date, title, categoryId: category.id, accountId: account.id, needsReview },
    });
  const imported = await make(`Imported ${stamp}`, true);
  await make(`Typed ${stamp}`, false);

  await signInWithPassword(page, email, "e2e-password-123");
  await expectDashboardHome(page);
  const log = expenseLogLocator(page);
  await log.getByTestId("needs-review-filter").filter({ visible: true }).click();
  await expect(log.getByText(`Typed ${stamp}`).filter({ visible: true })).toHaveCount(0);
  await expect(log.getByText(`Imported ${stamp}`).filter({ visible: true })).toHaveCount(1);

  await log.getByRole("button", { name: "Mark 1 shown as reviewed" }).filter({ visible: true }).click();
  await expect.poll(async () => (await prisma.transaction.findUniqueOrThrow({ where: { id: imported.id } })).needsReview).toBe(false);
  await expect(log.getByTestId("needs-review-filter")).toHaveCount(0);
  await expect(log.getByText(`Typed ${stamp}`).filter({ visible: true })).toHaveCount(1);
});
