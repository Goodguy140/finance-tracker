import { expect, test, type Page } from "@playwright/test";
import { hash } from "bcryptjs";
import { CategoryKind, TransactionType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { normalizeMerchant } from "../../src/lib/plaid/merchant-text";
import { expectDashboardHome } from "./expect-dashboard-home";
import { uniqueStamp } from "./helpers";

const DESKTOP_ONLY = "Insight actions are the same on every viewport; the desktop project covers them";

/** A merchant name unique to this run. Digits would be stripped as reference numbers. */
function uniqueMerchant(prefix: string) {
  const letters = uniqueStamp()
    .replace(/[^0-9]/g, "")
    .slice(-8)
    .split("")
    .map((d) => String.fromCharCode(97 + Number(d)))
    .join("");
  return `${prefix} ${letters}`;
}

/** UTC midnight `days` ago — how date-only values are stored. */
function daysAgo(days: number) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days));
}

async function seedUser(page: Page, label: string) {
  const email = `e2e-insights-${label}-${uniqueStamp()}@example.com`;
  const password = "e2e-password-123";
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hash(password, 12),
      displayName: "E2E Insights User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  const [account, category] = await Promise.all([
    prisma.account.findFirstOrThrow({ where: { userId: user.id } }),
    prisma.category.findFirstOrThrow({ where: { userId: user.id, kind: CategoryKind.EXPENSE, name: "Fun" } }),
  ]);
  const addExpenses = (title: string, amountCents: number, ages: number[]) =>
    prisma.transaction.createMany({
      data: ages.map((age) => ({
        userId: user.id,
        accountId: account.id,
        categoryId: category.id,
        type: TransactionType.EXPENSE,
        amountCents,
        title,
        date: daysAgo(age),
      })),
    });

  const login = async () => {
    await page.goto("/login");
    await page.getByPlaceholder("Email").fill(email);
    await page.getByPlaceholder("Password").fill(password);
    await page.getByRole("button", { name: "Login" }).click();
    await expectDashboardHome(page);
  };
  return { user, addExpenses, login };
}

function insightCard(page: Page, key: string) {
  return page.locator(`[data-testid="insight"][data-insight-key="${key}"]`);
}

test("a detected recurring charge can be tracked, and then stops being suggested", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", DESKTOP_ONLY);
  const { user, addExpenses, login } = await seedUser(page, "track");
  const merchant = uniqueMerchant("Zenflix");
  await addExpenses(merchant, 1599, [91, 61, 30, 1]);
  const key = `recurring:EXPENSE:${normalizeMerchant(merchant)}`;

  await login();
  await expect(page.getByRole("region", { name: "Insights" })).toContainText(`${merchant} looks recurring`);

  await page.goto("/insights");
  const card = insightCard(page, key);
  await expect(card).toContainText("every month");
  await card.getByRole("button", { name: "Track it" }).click();
  await expect(card.locator('input[name="name"]')).toHaveValue(merchant);
  await expect(card.locator('select[name="cadence"]')).toHaveValue("MONTHLY");
  await card.getByRole("button", { name: "Add recurring transaction" }).click();

  // The rule row is the action's only write.
  await expect
    .poll(() => prisma.recurringTransaction.findFirst({ where: { userId: user.id, name: merchant } }), { timeout: 10_000 })
    .toMatchObject({ amountCents: 1599, cadence: "MONTHLY", postMode: "REVIEW" });
  await page.reload();
  await expect(insightCard(page, key)).toHaveCount(0);
});

test("dismissing a suggestion hides it until it is restored", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", DESKTOP_ONLY);
  const { user, addExpenses, login } = await seedUser(page, "dismiss");
  const merchant = uniqueMerchant("Gymbox");
  await addExpenses(merchant, 4500, [92, 61, 31, 2]);
  const key = `recurring:EXPENSE:${normalizeMerchant(merchant)}`;

  await login();
  await page.goto("/insights");
  await insightCard(page, key).getByRole("button", { name: "Not recurring" }).click();
  await expect
    .poll(() => prisma.insightDismissal.findFirst({ where: { userId: user.id, insightKey: key } }), { timeout: 10_000 })
    .toMatchObject({ snoozedUntil: null });

  await page.reload();
  const recurringSection = page.getByRole("region", { name: /Recurring charges we noticed/ });
  await expect(recurringSection.locator(`[data-insight-key="${key}"]`)).toHaveCount(0);

  await page.getByText(/Dismissed and snoozed/).click();
  await insightCard(page, key).getByRole("button", { name: "Restore" }).click();
  await expect
    .poll(() => prisma.insightDismissal.count({ where: { userId: user.id, insightKey: key } }), { timeout: 10_000 })
    .toBe(0);
  await page.reload();
  await expect(recurringSection.locator(`[data-insight-key="${key}"]`)).toHaveCount(1);
});

test("?tag= narrows insights to tagged entries, and Show all clears it", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", DESKTOP_ONLY);
  const { user, addExpenses, login } = await seedUser(page, "tag");
  const tagged = uniqueMerchant("Tripflix");
  const plain = uniqueMerchant("Homeflix");
  await addExpenses(tagged, 1299, [91, 61, 30, 1]);
  await addExpenses(plain, 1899, [92, 62, 31, 2]);
  const tag = await prisma.tag.create({ data: { userId: user.id, name: "Trip", nameKey: "trip" } });
  const taggedRows = await prisma.transaction.findMany({ where: { userId: user.id, title: tagged }, select: { id: true } });
  await prisma.transactionTag.createMany({ data: taggedRows.map((t) => ({ transactionId: t.id, tagId: tag.id })) });
  const taggedKey = `recurring:EXPENSE:${normalizeMerchant(tagged)}`;
  const plainKey = `recurring:EXPENSE:${normalizeMerchant(plain)}`;

  await login();
  await page.goto("/insights");
  await expect(insightCard(page, taggedKey)).toHaveCount(1);
  await expect(insightCard(page, plainKey)).toHaveCount(1);

  await page.getByTestId("tag-filter").selectOption(tag.id);
  await expect(page).toHaveURL(new RegExp(`[?&]tag=${tag.id}`));
  await expect(page.getByTestId("insights-tag-note")).toContainText("#Trip");
  await expect(insightCard(page, taggedKey)).toHaveCount(1);
  await expect(insightCard(page, plainKey)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Reports" })).toHaveAttribute("href", `/reports?tag=${tag.id}`);

  await page.getByRole("link", { name: "Show all" }).click();
  await expect(page).toHaveURL(/\/insights$/);
  await expect(insightCard(page, plainKey)).toHaveCount(1);
});

test("habit spending is flagged, and turning it off stops the analysis", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", DESKTOP_ONLY);
  const { user, addExpenses, login } = await seedUser(page, "habit");
  await addExpenses("SQDC MONTREAL", 4200, [70, 45, 20, 5]);

  await login();
  await page.goto("/insights");
  const habitCard = insightCard(page, "habit:CANNABIS");
  await expect(habitCard).toContainText("Cannabis");
  await expect(habitCard).toContainText("4 purchases in the last 70 days");

  await page.getByRole("button", { name: "Turn off habit insights" }).click();
  await expect
    .poll(() => prisma.insightPreference.findUnique({ where: { userId: user.id } }), { timeout: 10_000 })
    .toMatchObject({ habitDetectionEnabled: false });
  await page.reload();
  await expect(page.getByTestId("habit-detection-state")).toHaveText("off");
  await expect(page.getByRole("region", { name: "Spending habits" })).toHaveCount(0);
  await expect(insightCard(page, "habit:CANNABIS")).toHaveCount(0);
});

test("tracking a habit separately creates its category and a rule ahead of the others", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", DESKTOP_ONLY);
  const { user, addExpenses, login } = await seedUser(page, "habit-track");
  await addExpenses("LCBO #217", 3500, [60, 30, 3]);
  await prisma.transactionRule.create({
    data: { userId: user.id, priority: 0, titleOperator: "CONTAINS", titlePattern: "costco" },
  });

  await login();
  await page.goto("/insights");
  await insightCard(page, "habit:ALCOHOL").getByRole("button", { name: "Track separately" }).click();

  // Rules are written after the category, so the rule is what to wait on.
  await expect
    .poll(
      () =>
        prisma.transactionRule.findMany({
          where: { userId: user.id },
          orderBy: { priority: "asc" },
          select: { titlePattern: true, titleOperator: true, priority: true, setCategory: { select: { name: true } } },
        }),
      { timeout: 10_000 },
    )
    .toEqual([
      { titlePattern: "lcbo", titleOperator: "STARTS_WITH", priority: 0, setCategory: { name: "Alcohol" } },
      { titlePattern: "costco", titleOperator: "CONTAINS", priority: 1, setCategory: null },
    ]);
  await page.reload();
  await expect(insightCard(page, "habit:ALCOHOL")).toContainText("Tracked in Alcohol");
});
