import { expect, test } from "@playwright/test";
import { AccountType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { expectDashboardHome } from "./expect-dashboard-home";
import { hashTestPassword, signInWithPassword, uniqueStamp } from "./helpers";

test("debt payoff: rates and minimums are saved, and the plan compares the ways out", async ({ page }) => {
  const email = `e2e-debt-${uniqueStamp()}@example.com`;
  const password = "e2e-password-123";
  const user = await prisma.user.create({
    data: { email, passwordHash: await hashTestPassword(password), displayName: "E2E", countryCode: "CA", role: "USER" },
  });
  await ensureDefaultDataForUser(user);
  const today = new Date();
  const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const [visa, loan] = await Promise.all([
    prisma.account.create({ data: { userId: user.id, name: "Debt Visa", type: AccountType.CREDIT_CARD, interestRateBps: 1999, minimumPaymentCents: 10_000 } }),
    prisma.account.create({ data: { userId: user.id, name: "Debt Car loan", type: AccountType.LOAN } }),
  ]);
  await prisma.accountBalanceSnapshot.createMany({
    data: [
      { userId: user.id, accountId: visa.id, date, balanceCents: 300_000, source: "MANUAL" },
      { userId: user.id, accountId: loan.id, date, balanceCents: 900_000, source: "MANUAL" },
    ],
  });

  await signInWithPassword(page, email, password);
  await expectDashboardHome(page);
  await page.goto("/reports");
  await page.getByRole("link", { name: "Debt payoff plan" }).click();
  await expect(page.getByRole("heading", { name: "Debt payoff" })).toBeVisible();
  const plan = page.getByTestId("debt-plan");
  await expect(plan).toContainText("Add the rate and minimum for Debt Car loan");

  await page.getByLabel("Interest rate for Debt Car loan").fill("6.5");
  await page.getByLabel("Minimum payment for Debt Car loan").fill("250");
  await page.getByRole("button", { name: "Save Debt Car loan" }).click();
  await expect(plan).not.toContainText("Add the rate and minimum");
  expect(await prisma.account.findUniqueOrThrow({ where: { id: loan.id } })).toMatchObject({
    interestRateBps: 650,
    minimumPaymentCents: 25_000,
  });

  // Paying $600 a month, highest rate first: the card goes before the loan.
  await plan.getByLabel("Paying each month").fill("600");
  await plan.getByRole("button", { name: "Work it out" }).click();
  await expect(page.getByTestId("debt-order").locator("li").first()).toContainText("Debt Visa");
  await expect(page.getByTestId("debt-strategy-avalanche")).toContainText("Debt-free by");
  await page.getByTestId("debt-strategy-minimums").click();
  await expect(page.getByTestId("debt-strategy-minimums")).toHaveAttribute("aria-current", "true");
});
