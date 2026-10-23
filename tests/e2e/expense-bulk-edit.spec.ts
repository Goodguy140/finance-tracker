import { expect, test } from "@playwright/test";
import { CategoryKind, TransactionType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { expectDashboardHome } from "./expect-dashboard-home";
import { expenseLogLocator, hashTestPassword, signInWithPassword, uniqueStamp } from "./helpers";

test("bulk edit moves picked expenses to a category, then deletes them with one Undo", async ({ page }) => {
  const stamp = uniqueStamp();
  const email = `e2e-bulk-${stamp}@example.com`;
  const password = "e2e-password-123";
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword(password),
      displayName: "E2E Bulk User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  const [from, to] = await prisma.category.findMany({
    where: { userId: user.id, kind: CategoryKind.EXPENSE },
    orderBy: { name: "asc" },
    take: 2,
  });
  const account = await prisma.account.findFirstOrThrow({ where: { userId: user.id } });
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15));
  const titles = ["Alpha", "Bravo", "Charlie"].map((t) => `${t} ${stamp}`);
  const rows = await Promise.all(
    titles.map((title, i) =>
      prisma.transaction.create({
        data: {
          userId: user.id,
          type: TransactionType.EXPENSE,
          amountCents: 1000 + i,
          date,
          title,
          categoryId: from.id,
          accountId: account.id,
        },
      }),
    ),
  );
  const [alpha, bravo, charlie] = rows;

  await signInWithPassword(page, email, password);
  await expectDashboardHome(page);
  // The dashboard adds ?month= just after load, and that re-render remounts the log.
  await expect(page).toHaveURL(/[?&]month=/);

  const log = expenseLogLocator(page);
  await log.getByRole("button", { name: "Select", exact: true }).click();
  const bar = log.getByTestId("expense-bulk-bar");
  await expect(bar).toContainText("0 selected");
  await log.getByRole("checkbox", { name: `Select ${titles[0]}` }).check();
  await log.getByRole("checkbox", { name: `Select ${titles[1]}` }).check();
  await expect(bar).toContainText("2 selected");

  await bar.getByLabel("New category for the selected expenses").selectOption(to.id);
  await bar.getByRole("button", { name: "Set category" }).click();
  await expect(log.getByTestId("expense-bulk-result")).toHaveText("Moved 2 expenses.");
  const moved = await prisma.transaction.findMany({ where: { id: { in: rows.map((r) => r.id) } } });
  expect(moved.find((r) => r.id === alpha.id)!.categoryId).toBe(to.id);
  expect(moved.find((r) => r.id === bravo.id)!.categoryId).toBe(to.id);
  expect(moved.find((r) => r.id === charlie.id)!.categoryId).toBe(from.id);
  await expect(bar).toContainText("0 selected");

  await bar.getByRole("button", { name: "Select all 3 shown" }).click();
  await expect(bar).toContainText("3 selected");
  await bar.getByRole("button", { name: "Delete selected" }).click();
  const toast = page.getByTestId("undo-toast");
  await expect(toast).toContainText("3 expenses deleted");
  expect(await prisma.transaction.count({ where: { id: { in: rows.map((r) => r.id) } } })).toBe(0);

  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(toast).toBeHidden();
  await expect.poll(() => prisma.transaction.count({ where: { id: { in: rows.map((r) => r.id) } } })).toBe(3);
  await expect(log.getByText(titles[2]).filter({ visible: true }).first()).toBeVisible();
});
