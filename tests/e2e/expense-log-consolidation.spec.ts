import { expect, test } from "@playwright/test";
import { CategoryKind, TransactionType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { expectDashboardHome } from "./expect-dashboard-home";
import { expenseLogLocator, hashTestPassword, signInWithPassword, uniqueStamp } from "./helpers";

test("consolidates same day/title/account expenses and keeps each editable", async ({ page }) => {
  const stamp = uniqueStamp();
  const email = `e2e-consolidate-${stamp}@example.com`;
  const password = "e2e-password-123";

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword(password),
      displayName: "E2E Consolidation User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);

  const [categories, accounts] = await Promise.all([
    prisma.category.findMany({
      where: { userId: user.id, kind: CategoryKind.EXPENSE },
      orderBy: { name: "asc" },
    }),
    prisma.account.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
  ]);
  const [visa, other] = accounts;

  // Mid-month UTC date so the dashboard's month period contains it in any timezone.
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15));
  const otherDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 16));
  const title = `Costco run ${stamp}`;

  await prisma.transaction.createMany({
    data: [
      // Three consolidation candidates: same date, title, and account.
      {
        userId: user.id,
        type: TransactionType.EXPENSE,
        amountCents: 5210,
        date,
        title,
        categoryId: categories[0].id,
        accountId: visa.id,
      },
      {
        userId: user.id,
        type: TransactionType.EXPENSE,
        amountCents: 6000,
        date,
        title,
        categoryId: categories[1].id,
        accountId: visa.id,
      },
      {
        userId: user.id,
        type: TransactionType.EXPENSE,
        amountCents: 3050,
        date,
        title,
        categoryId: categories[0].id,
        accountId: visa.id,
      },
      // Same title + account but a different date — must stay on its own row.
      {
        userId: user.id,
        type: TransactionType.EXPENSE,
        amountCents: 1111,
        date: otherDate,
        title,
        categoryId: categories[0].id,
        accountId: visa.id,
      },
      // Same title + date but a different account — must stay on its own row.
      {
        userId: user.id,
        type: TransactionType.EXPENSE,
        amountCents: 2222,
        date,
        title,
        categoryId: categories[0].id,
        accountId: other.id,
      },
    ],
  });

  await signInWithPassword(page, email, password);
  await expectDashboardHome(page);

  const log = expenseLogLocator(page);
  const search = log.getByPlaceholder("Search title, category, account, note, amount…");
  await search.fill(title);

  // The five transactions collapse to three rows: one group of 3 + two singletons.
  // The card header's settings popover is an aria-expanded button too; the group headers are
  // the ones that are not popover triggers.
  const groupHeader = log.locator('button[aria-expanded="false"]:not([aria-haspopup])');
  await expect(groupHeader).toHaveCount(1);
  await expect(groupHeader).toContainText("3 transactions");
  await expect(groupHeader.getByTestId("expense-amount")).toHaveText("$142.60");

  const rows = log.getByRole("button").filter({ hasText: title });
  await expect(rows).toHaveCount(3);
  // A row's amount, shown with no label; hidden group members are not visible.
  const shownAmount = (amount: string) =>
    log.getByTestId("expense-amount").filter({ visible: true }).getByText(amount, { exact: true });
  await expect(shownAmount("$11.11")).toHaveCount(1);
  await expect(shownAmount("$22.22")).toHaveCount(1);

  // Members are hidden until the group is expanded.
  await expect(shownAmount("$52.10")).toHaveCount(0);

  await groupHeader.click();
  await expect(log.locator('button[aria-expanded="true"]:not([aria-haspopup])')).toHaveCount(1);
  for (const amount of ["$52.10", "$60.00", "$30.50"]) {
    await expect(shownAmount(amount)).toHaveCount(1);
  }

  // Each member opens its own edit modal.
  await shownAmount("$60.00").click();
  const dialog = page.getByRole("dialog", { name: "Edit expense" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('input[name="amount"]')).toHaveValue("60.00");

  // Editing one member out of the group leaves the other two consolidated.
  await dialog.locator('input[name="amount"]').fill("75.00");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toBeHidden();

  await search.fill(title);
  // The group survives the post-save refresh, still expanded, with the new total.
  const updatedGroup = log.getByRole("button", { expanded: true });
  await expect(updatedGroup).toHaveCount(1);
  await expect(updatedGroup).toContainText("3 transactions");
  await expect(updatedGroup.getByTestId("expense-amount")).toHaveText("$157.60");
  await expect(shownAmount("$75.00")).toHaveCount(1);

  // Collapsing hides the members again.
  await updatedGroup.click();
  await expect(shownAmount("$75.00")).toHaveCount(0);
});
