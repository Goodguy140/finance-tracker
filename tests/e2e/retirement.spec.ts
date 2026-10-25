import { expect, test } from "@playwright/test";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { expectDashboardHome } from "./expect-dashboard-home";
import { hashTestPassword, signInWithPassword, uniqueStamp } from "./helpers";

test("the retirement page projects savings to an FI age from the user's balances", async ({ page }) => {
  const stamp = uniqueStamp().replace(/[^a-z0-9]/gi, "");
  const email = `e2e-retire-${stamp}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword("e2e-password-123"),
      displayName: "E2E Retire User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  const tfsa = await prisma.account.create({ data: { userId: user.id, name: "My TFSA", type: "TFSA" } });
  await prisma.accountBalanceSnapshot.create({
    data: { userId: user.id, accountId: tfsa.id, date: new Date("2026-01-02T00:00:00Z"), balanceCents: 10_000_000, source: "MANUAL" },
  });

  await signInWithPassword(page, email, "e2e-password-123");
  await expectDashboardHome(page);
  await page.goto("/reports");
  await page.getByRole("link", { name: "Retirement", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Retirement");
  await expect(page.getByTestId("retire-need-age")).toBeVisible();

  // A 0% real return keeps the arithmetic plain: $100,000 plus $30,000 a year.
  await page.getByLabel("Your age").fill("40");
  await page.getByLabel("Saving a year").fill("30000");
  await page.getByLabel("Spending a year in retirement").fill("30000");
  await page.getByLabel("Return %").fill("4");
  await page.getByLabel("Inflation %").fill("4");
  await page.getByRole("button", { name: "Work it out" }).click();

  await expect(page.getByTestId("retire-summary")).toContainText("$750,000");
  await expect(page.getByTestId("retire-fi-age")).toContainText("At 61");
  await expect(page.getByTestId("retire-summary")).toContainText("$850,000");
  await expect(page.getByTestId("retire-runs-out")).toContainText("Until 93");
  await expect(page.getByTestId("retire-allocation")).toContainText("TFSA$7,000");
});
