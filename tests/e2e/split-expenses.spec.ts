import { expect, test } from "@playwright/test";
import { hash } from "bcryptjs";
import { CategoryKind, TransactionType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { expectDashboardHome } from "./expect-dashboard-home";
import { expenseLogLocator, uniqueStamp } from "./helpers";

test("an existing split expense opens in the edit dialog and its lines can be changed", async ({ page }) => {
  const stamp = uniqueStamp();
  const email = `e2e-split-${stamp}@example.com`;
  const password = "e2e-password-123";

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hash(password, 12),
      displayName: "E2E Split User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  const [categories, account] = await Promise.all([
    prisma.category.findMany({ where: { userId: user.id, kind: CategoryKind.EXPENSE }, orderBy: { name: "asc" }, take: 2 }),
    prisma.account.findFirstOrThrow({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
  ]);
  const [first, second] = categories;

  // Mid-month UTC date so the dashboard's month period contains it in any timezone.
  const now = new Date();
  const title = `Costco ${stamp}`;
  const costco = await prisma.transaction.create({
    data: {
      userId: user.id,
      type: TransactionType.EXPENSE,
      amountCents: 10000,
      date: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15)),
      title,
      categoryId: first.id,
      accountId: account.id,
      splitParts: {
        create: [
          { userId: user.id, categoryId: first.id, amountCents: 6000 },
          { userId: user.id, categoryId: second.id, amountCents: 4000 },
        ],
      },
    },
  });

  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Login" }).click();
  await expectDashboardHome(page);

  const log = expenseLogLocator(page);
  await log.getByRole("button").filter({ hasText: title }).filter({ visible: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Edit expense" });
  const editor = dialog.getByTestId("split-lines-editor");
  await expect(editor.getByTestId("split-left-to-assign")).toHaveText("Lines match the amount");

  // Off by a dollar: the dialog says so and the save is refused.
  const amounts = editor.getByPlaceholder("0.00");
  await amounts.nth(1).fill("39");
  await expect(editor.getByTestId("split-left-to-assign")).toHaveText("$1.00 left to assign");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog.getByText("The split lines add up to 99.00, but the expense is 100.00. Make them match.")).toBeVisible();

  await amounts.nth(1).fill("25");
  await editor.getByRole("button", { name: "Add line" }).click();
  await editor.getByLabel("Split line 3 category").selectOption(second.id);
  await amounts.nth(2).fill("15");
  await expect(editor.getByTestId("split-left-to-assign")).toHaveText("Lines match the amount");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toBeHidden();

  // The save is one database transaction, so the parts are never read half-replaced.
  await expect
    .poll(async () =>
      (await prisma.splitTransactionPart.findMany({ where: { transactionId: costco.id }, orderBy: { id: "asc" } })).map(
        (p) => [p.categoryId, p.amountCents],
      ),
    )
    .toEqual([
      [first.id, 6000],
      [second.id, 2500],
      [second.id, 1500],
    ]);
});
