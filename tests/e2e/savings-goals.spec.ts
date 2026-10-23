import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { AccountType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { expectDashboardHome } from "./expect-dashboard-home";
import { hashTestPassword, signInWithPassword, uniqueStamp } from "./helpers";

function daysAgo(days: number) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days));
}

function ymdMonthsAhead(months: number) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, now.getUTCDate())).toISOString().slice(0, 10);
}

const SCREENSHOT_DIR = process.env.E2E_SCREENSHOT_DIR;

test("savings goals follow an account's balance or a hand-kept amount, and show on Insights", async ({ page }, testInfo) => {
  const email = `e2e-goals-${uniqueStamp()}@example.com`;
  const password = "e2e-password-123";
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword(password),
      displayName: "E2E Goals User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  const savings = await prisma.account.create({ data: { userId: user.id, name: "High interest", type: AccountType.SAVINGS } });
  // Grew $3,000 over about three months: roughly $1,000 a month.
  await prisma.accountBalanceSnapshot.createMany({
    data: [
      { userId: user.id, accountId: savings.id, date: daysAgo(91), balanceCents: 200_000, source: "MANUAL" },
      { userId: user.id, accountId: savings.id, date: daysAgo(1), balanceCents: 500_000, source: "MANUAL" },
    ],
  });

  await signInWithPassword(page, email, password);
  await expectDashboardHome(page);

  await page.goto("/settings/goals");
  const panel = page.getByTestId("savings-goals");
  await expect(panel).toContainText("No goals yet.");

  // A goal on the savings account: $5,000 of $10,000.
  await panel.getByRole("button", { name: "New goal" }).click();
  let dialog = page.getByRole("dialog", { name: "New savings goal" });
  await dialog.getByLabel("Name").fill("Emergency fund");
  await dialog.getByLabel("Target").fill("10000");
  await dialog.getByLabel("Reach it by (optional)").fill(ymdMonthsAhead(12));
  await dialog.getByLabel("Saving in").selectOption({ label: "High interest (Savings)" });
  await expect(dialog.getByLabel("Saved so far")).toHaveCount(0);
  if (SCREENSHOT_DIR) {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await dialog.screenshot({ path: `${SCREENSHOT_DIR}/new-goal-${testInfo.project.name}.png` });
  }
  await dialog.getByRole("button", { name: "Add goal" }).click();
  await expect(dialog).toBeHidden();
  const emergency = panel.getByTestId("savings-goal-row").filter({ hasText: "Emergency fund" });
  await expect(emergency).toContainText("$5,000.00");
  await expect(emergency).toContainText("50%");
  await expect(emergency).toContainText("On track");

  // A goal kept by hand, then money added to it.
  await panel.getByRole("button", { name: "New goal" }).click();
  dialog = page.getByRole("dialog", { name: "New savings goal" });
  await dialog.getByLabel("Name").fill("Trip");
  await dialog.getByLabel("Target").fill("2000");
  await dialog.getByLabel("Saved so far").fill("500");
  await dialog.getByRole("button", { name: "Add goal" }).click();
  await expect(dialog).toBeHidden();
  const trip = panel.getByTestId("savings-goal-row").filter({ hasText: "Trip" });
  await expect(trip).toContainText("Tracked by hand");
  await expect(trip).toContainText("25%");

  await trip.getByRole("button", { name: "Add money to Trip" }).click();
  dialog = page.getByRole("dialog", { name: "Add money to “Trip”" });
  await dialog.getByLabel("Amount").fill("250");
  await dialog.getByRole("button", { name: "Add" }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(async () => (await prisma.savingsGoal.findFirst({ where: { userId: user.id, name: "Trip" } }))?.savedCents ?? null)
    .toBe(75_000);
  await expect(trip).toContainText("$750.00");

  if (SCREENSHOT_DIR) await panel.screenshot({ path: `${SCREENSHOT_DIR}/settings-${testInfo.project.name}.png` });

  await page.goto("/insights");
  const card = page.getByTestId("savings-goals-card");
  await expect(card).toContainText("Emergency fund");
  await expect(card).toContainText("Trip");
  await expect(card.getByRole("progressbar", { name: "Emergency fund progress" })).toHaveAttribute("aria-valuenow", "50");
  if (SCREENSHOT_DIR) await card.screenshot({ path: `${SCREENSHOT_DIR}/insights-${testInfo.project.name}.png` });

  // Deleting asks in the page, then removes only the goal.
  await page.goto("/settings/goals");
  await trip.getByRole("button", { name: "Delete Trip" }).click();
  const confirm = page.getByRole("dialog", { name: "Delete the goal “Trip”?" });
  await confirm.getByRole("button", { name: "Delete goal" }).click();
  await expect(trip).toHaveCount(0);
  await expect.poll(async () => prisma.savingsGoal.count({ where: { userId: user.id } })).toBe(1);
});

test("a goal with no date gets an estimated completion date from transfers into its account", async ({ page }) => {
  const email = `e2e-goals-eta-${uniqueStamp()}@example.com`;
  const password = "e2e-password-123";
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword(password),
      displayName: "E2E Goals User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  const [chequing, transfers] = await Promise.all([
    prisma.account.findFirstOrThrow({ where: { userId: user.id } }),
    prisma.category.create({ data: { userId: user.id, name: "Transfers", kind: "TRANSFER" } }),
  ]);
  const savings = await prisma.account.create({
    data: { userId: user.id, name: "Rainy day", type: AccountType.SAVINGS, countsAsSavings: true },
  });
  // One balance reading is not enough for a pace; $500 a month moved in is.
  await prisma.accountBalanceSnapshot.create({
    data: { userId: user.id, accountId: savings.id, date: daysAgo(1), balanceCents: 200_000, source: "MANUAL" },
  });
  await prisma.transaction.createMany({
    data: [75, 45, 15].map((age) => ({
      userId: user.id,
      accountId: chequing.id,
      transferAccountId: savings.id,
      categoryId: transfers.id,
      type: "TRANSFER" as const,
      amountCents: 50_000,
      title: "To savings",
      date: daysAgo(age),
    })),
  });
  await prisma.savingsGoal.create({
    data: { userId: user.id, name: "New roof", targetCents: 700_000, accountId: savings.id },
  });

  await signInWithPassword(page, email, password);
  await expectDashboardHome(page);

  await page.goto("/insights");
  const advice = page.getByTestId("savings-goals-card").getByTestId("goal-advice");
  await expect(advice).toContainText("you've transferred about");
  await expect(advice).toContainText("At that rate of transfers, you'd reach it around");
});
