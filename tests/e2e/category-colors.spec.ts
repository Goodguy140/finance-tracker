import { expect, test, type Locator } from "@playwright/test";
import { hash } from "bcryptjs";
import { CategoryKind, TransactionType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { expectDashboardHome } from "./expect-dashboard-home";
import { expenseLogLocator, uniqueStamp } from "./helpers";

/** The swatch colour of a legend entry, normalised to rgb() the way the browser reports it. */
async function swatchColor(swatch: Locator): Promise<string> {
  return swatch.evaluate((el) => {
    const probe = document.createElement("span");
    probe.style.color = el.getAttribute("fill") ?? "";
    document.body.appendChild(probe);
    const rgb = getComputedStyle(probe).color;
    probe.remove();
    return rgb;
  });
}

test("a category's dot in the log is the colour of its slice in the pie", async ({ page }) => {
  const stamp = uniqueStamp();
  const email = `e2e-category-colors-${stamp}@example.com`;
  const password = "e2e-password-123";

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hash(password, 12),
      displayName: "E2E Category Colours",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);

  const [categories, account] = await Promise.all([
    prisma.category.findMany({ where: { userId: user.id, kind: CategoryKind.EXPENSE }, orderBy: { name: "asc" } }),
    prisma.account.findFirstOrThrow({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
  ]);
  const used = categories.slice(0, 6);
  expect(used).toHaveLength(6);

  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15));
  // Distinct amounts so the pie ranks the categories in a different order than their names.
  const amounts = [1200, 9800, 4300, 2500, 7100, 3600];
  const expenses = used.map((category, i) => ({
    title: `Colour check ${i} ${stamp}`,
    category,
    amountCents: amounts[i],
  }));
  await prisma.transaction.createMany({
    data: expenses.map((e) => ({
      userId: user.id,
      type: TransactionType.EXPENSE,
      amountCents: e.amountCents,
      date,
      title: e.title,
      categoryId: e.category.id,
      accountId: account.id,
    })),
  });

  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Login" }).click();
  await expectDashboardHome(page);

  const pieCard = page.getByRole("region", { name: "Spending by category" });
  const legend = pieCard.locator(".recharts-legend-item");
  await expect(legend).toHaveCount(used.length);

  const log = expenseLogLocator(page);
  const sliceColors = new Set<string>();
  for (const e of expenses) {
    const legendItem = legend.filter({ hasText: e.category.name });
    const sliceColor = await swatchColor(legendItem.locator('svg [fill]:not([fill="none"])').first());
    sliceColors.add(sliceColor);

    const row = log.getByRole("button").filter({ hasText: e.title }).first();
    const dot = row.locator("[data-category-dot]").first();
    await expect(dot, `${e.category.name}: log dot should match its pie slice`).toHaveCSS("background-color", sliceColor);
  }
  // Six categories, six colours: no two slices share one.
  expect(sliceColors.size).toBe(used.length);
});
