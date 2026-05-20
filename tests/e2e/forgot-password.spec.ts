import { expect, test } from "@playwright/test";
import { hash } from "bcryptjs";
import { prisma } from "../../src/lib/prisma";

test("forgot password creates a reset token", async ({ page }) => {
  const stamp = Date.now();
  const email = `e2e-forgot-${stamp}@example.com";

  await prisma.user.create({
    data: {
      email,
      passwordHash: await hash("e2e-password-123", 12),
      displayName: "E2E User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });

  await page.goto("/forgot-password");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByRole("button", { name: "Request reset" }).click();

  const tokens = await prisma.passwordResetToken.findMany({
    where: { user: { email } },
  });
  expect(tokens.length).toBeGreaterThan(0);
});
