import { expect, test } from "@playwright/test";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { expectDashboardHome } from "./expect-dashboard-home";
import { hashTestPassword, signInWithPassword, uniqueStamp } from "./helpers";

test("user can login with email/password", async ({ page }) => {
  const stamp = uniqueStamp();
  const email = `e2e-${stamp}@example.com`;
  const password = "e2e-password-123";

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword(password),
      displayName: "E2E User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);

  await signInWithPassword(page, email, password);

  await expectDashboardHome(page);
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible();
});

test("user can login with email/password when optional Google settings are unreadable", async ({ page }) => {
  const stamp = uniqueStamp();
  const email = `e2e-bad-google-${stamp}@example.com`;
  const password = "e2e-password-123";

  await prisma.serverSetting.upsert({
    where: { key: "oauth.google.enabled" },
    create: {
      key: "oauth.google.enabled",
      encryptedValue: "00000000000000000000000000000000:00000000000000000000000000000000:00",
    },
    update: {
      encryptedValue: "00000000000000000000000000000000:00000000000000000000000000000000:00",
    },
  });
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword(password),
      displayName: "E2E Bad Google User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);

  await signInWithPassword(page, email, password);

  await expectDashboardHome(page);
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible();
});

test("user can logout and is redirected to login", async ({ page }) => {
  const stamp = uniqueStamp();
  const email = `e2e-logout-${stamp}@example.com`;
  const password = "e2e-password-123";

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword(password),
      displayName: "E2E Logout User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);

  await signInWithPassword(page, email, password);

  await expectDashboardHome(page);
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();

  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("button", { name: "Account menu" })).not.toBeVisible();
  await expect(page.getByPlaceholder("Email")).toBeVisible();

  const sessionRes = await page.request.get("/api/auth/session");
  expect(sessionRes.ok()).toBeTruthy();
  const body = (await sessionRes.json()) as { user?: unknown };
  expect(body.user).toBeUndefined();
});
