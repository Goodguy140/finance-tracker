import { expect, test } from "@playwright/test";
import { prisma } from "../../src/lib/prisma";
import { hashTestPassword, uniqueStamp } from "./helpers";

test("forgot password creates a reset token", async ({ page }) => {
  const stamp = uniqueStamp();
  const email = "e2e-forgot-" + stamp + "@example.com";

  await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword("e2e-password-123"),
      displayName: "E2E User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });

  await page.goto("/forgot-password");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByRole("button", { name: "Request reset" }).click();

  await expect.poll(async () => {
    return prisma.passwordResetToken.count({ where: { user: { email } } });
  }).toBeGreaterThan(0);
});
