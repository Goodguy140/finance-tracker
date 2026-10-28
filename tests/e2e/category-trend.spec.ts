import { expect, test } from "@playwright/test";
import { CategoryKind, TransactionType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { shiftYm } from "../../src/lib/dashboard-period";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { currentYmInTimeZone } from "../../src/lib/period-month";
import { expectDashboardHome } from "./expect-dashboard-home";
import { hashTestPassword, signInWithPassword, uniqueStamp } from "./helpers";

const PASSWORD = "e2e-password-123";

test("a budget's name on the dashboard opens its category's trend page", async ({ page }) => {
  const stamp = uniqueStamp().replace(/[^a-z0-9]/gi, "");
  const email = `e2e-category-trend-${stamp}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword(PASSWORD),
      displayName: "E2E Trend User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  const thisYm = currentYmInTimeZone("America/Toronto");
  const account = await prisma.account.findFirstOrThrow({ where: { userId: user.id } });
  const pets = await prisma.category.create({ data: { userId: user.id, name: `Pets ${stamp}`, kind: CategoryKind.EXPENSE } });
  await prisma.budget.create({ data: { userId: user.id, categoryId: pets.id, periodMonth: shiftYm(thisYm, -1), limitCents: 150_00 } });
  for (const [ym, cents, title] of [
    [shiftYm(thisYm, -1), 120_00, "Pet Valu"],
    [thisYm, 40_00, "Pet Valu"],
    [thisYm, 95_00, "Vet clinic"],
  ] as const) {
    await prisma.transaction.create({
      data: {
        userId: user.id,
        accountId: account.id,
        categoryId: pets.id,
        type: TransactionType.EXPENSE,
        amountCents: cents,
        date: new Date(`${ym}-01T12:00:00Z`),
        title,
      },
    });
  }

  await signInWithPassword(page, email, PASSWORD);
  await expectDashboardHome(page);
  await page.getByRole("region", { name: "Budgets" }).getByRole("link", { name: pets.name }).click();

  await expect(page.getByTestId("category-name")).toHaveText(pets.name);
  const tiles = page.getByTestId("category-trend-tiles");
  await expect(tiles).toContainText("This month$135.00");
  await expect(tiles).toContainText("Last month$120.00");
  await expect(tiles).toContainText("Budget$150.00");
  await expect(page.getByTestId("category-trend-chart")).toBeVisible();
  await expect(page.getByTestId("category-payees").getByRole("link", { name: "Pet Valu" })).toHaveAttribute(
    "href",
    /\/reports\/merchant\?key=/,
  );
  await expect(page.getByTestId("category-biggest").locator("li").first()).toContainText("Vet clinic");
  await expect(page.getByRole("link", { name: "All its transactions" })).toHaveAttribute("href", `/search?category=${pets.id}`);
});
