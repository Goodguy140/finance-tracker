import { expect, test } from "@playwright/test";
import { hash } from "bcryptjs";
import { AccountType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { expectDashboardHome } from "./expect-dashboard-home";
import { uniqueStamp } from "./helpers";

test("room entered from CRA is reduced by contributions, and going over is flagged first", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Same forms on every viewport; the desktop project covers them");

  const stamp = uniqueStamp();
  const email = `e2e-room-${stamp}@example.com`;
  const password = "e2e-password-123";
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hash(password, 12),
      displayName: "E2E Room User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  const tfsa = await prisma.account.create({
    data: { userId: user.id, name: `Room TFSA ${stamp}`, type: AccountType.TFSA },
  });
  const year = new Date().getFullYear();

  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Login" }).click();
  await expectDashboardHome(page);

  await page.goto("/settings#contribution-room");
  const panel = page.locator("#contribution-room");
  await expect(panel.getByText("Add your")).toBeVisible();
  await panel.locator('select[name="accountType"]').selectOption("TFSA");
  await panel.locator('input[name="year"]').fill(String(year));
  await panel.locator('input[name="room"]').fill("7000");
  await panel.getByRole("button", { name: "Save room" }).click();
  await expect(panel.getByRole("button", { name: `Remove TFSA ${year} room` })).toBeVisible();
  await expect(panel.getByText("$7,000.00").first()).toBeVisible();

  await page.goto("/");
  await expectDashboardHome(page);
  // The Investments card is the second tab on the Insights card in the default layout.
  const investments = page.getByRole("region", { name: "Insights, Investments" });
  await investments.getByRole("tab", { name: "Investments" }).click();
  const flowForm = investments.getByRole("tabpanel").locator("form").filter({ has: page.locator('select[name="direction"]') });
  await flowForm.locator('select[name="accountId"]').selectOption(tfsa.id);
  const amount = flowForm.locator('input[name="amount"]');

  await amount.fill("6000");
  await expect(flowForm.getByRole("alert")).toHaveCount(0);

  await amount.fill("7500");
  await expect(flowForm.getByRole("alert")).toContainText(`$500.00 over your ${year} TFSA room`);
  await flowForm.getByRole("button", { name: "Add anyway" }).click();
  await expect
    .poll(() => prisma.investmentFlow.count({ where: { userId: user.id, accountId: tfsa.id } }))
    .toBe(1);

  await page.goto("/settings#contribution-room");
  await expect(panel.getByRole("alert")).toContainText(`$500.00 over your ${year} TFSA room`);
  await expect(panel.getByText("-$500.00")).toBeVisible();
});
