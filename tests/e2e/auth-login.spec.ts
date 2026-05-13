import { expect, test } from "@playwright/test";
import { hash } from "bcryptjs";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";

test("user can login with email/password", async ({ page }) => {
  const stamp = Date.now();
  const email = `e2e-${stamp}@example.com`;
  const password = "e2e-password-123";

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hash(password, 12),
      displayName: "E2E User",
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

  await expect(page).toHaveURL("/");
  await expect(page.getByRole("button", { name: "Logout" })).toBeVisible();
});

test("user can logout and is redirected to login", async ({ page }) => {
  const stamp = Date.now();
  const email = `e2e-logout-${stamp}@example.com`;
  const password = "e2e-password-123";

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hash(password, 12),
      displayName: "E2E Logout User",
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

  await expect(page).toHaveURL("/");
  await page.getByRole("button", { name: "Logout" }).click();

  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("button", { name: "Logout" })).not.toBeVisible();
  await expect(page.getByPlaceholder("Email")).toBeVisible();

  const sessionRes = await page.request.get("/api/auth/session");
  expect(sessionRes.ok()).toBeTruthy();
  const body = (await sessionRes.json()) as { user?: unknown };
  expect(body.user).toBeUndefined();
});
