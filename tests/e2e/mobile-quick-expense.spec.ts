import { expect, test } from "@playwright/test";
import { hash } from "bcryptjs";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { expectDashboardHome } from "./expect-dashboard-home";

test("mobile viewport: quick add expense appears in log", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile-chromium",
    "Quick add FAB is only rendered below the lg breakpoint",
  );

  const stamp = Date.now();
  const email = `e2e-mobile-${stamp}@example.com`;
  const password = "e2e-password-123";

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hash(password, 12),
      displayName: "E2E Mobile User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);

  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Login" }).click();

  await expectDashboardHome(page);

  await page.getByRole("button", { name: "Quick add expense" }).click();

  const sheet = page.getByRole("dialog", { name: "Add expense" });
  await expect(sheet).toBeVisible();

  const title = `Mobile café ${stamp}`;
  await sheet.getByPlaceholder("e.g. Weekly groceries, Shell fuel").fill(title);
  await sheet.locator('input[name="amount"]').fill("12.34");
  await sheet.getByRole("button", { name: "Add expense" }).click();

  // Log row renders the title twice (mobile card + desktop markup); assert any visible match.
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
});
