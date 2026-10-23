import { expect, test } from "@playwright/test";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { expectDashboardHome } from "./expect-dashboard-home";
import { expectExpenseInLog, hashTestPassword, signInWithPassword, uniqueStamp } from "./helpers";

test("mobile viewport: quick add expense appears in log", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile-chromium",
    "Quick add FAB is only rendered below the lg breakpoint",
  );

  const stamp = uniqueStamp();
  const email = `e2e-mobile-${stamp}@example.com`;
  const password = "e2e-password-123";

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword(password),
      displayName: "E2E Mobile User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);

  await signInWithPassword(page, email, password);

  await expectDashboardHome(page);

  await page.getByRole("button", { name: "Quick add expense" }).click();

  const sheet = page.getByRole("dialog", { name: "Add expense" });
  await expect(sheet).toBeVisible();

  const title = `Mobile café ${stamp}`;
  await sheet.getByPlaceholder("e.g. Weekly groceries, Shell fuel").fill(title);
  await sheet.locator('input[name="amount"]').fill("12.34");
  await sheet.getByRole("button", { name: "Add expense" }).click();

  await expectExpenseInLog(page, title);
});
