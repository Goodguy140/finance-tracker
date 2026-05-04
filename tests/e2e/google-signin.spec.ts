import { expect, test } from "@playwright/test";
import { prisma } from "../../src/lib/prisma";
import { encryptSecret } from "../../src/lib/security";

test("google sign-in redirects to Google OAuth screen", async ({ page }) => {
  await prisma.serverSetting.upsert({
    where: { key: "oauth.google.enabled" },
    create: { key: "oauth.google.enabled", encryptedValue: encryptSecret("true") },
    update: { encryptedValue: encryptSecret("true") },
  });
  await prisma.serverSetting.upsert({
    where: { key: "oauth.google.clientId" },
    create: { key: "oauth.google.clientId", encryptedValue: encryptSecret("fake-client-id") },
    update: { encryptedValue: encryptSecret("fake-client-id") },
  });
  await prisma.serverSetting.upsert({
    where: { key: "oauth.google.clientSecret" },
    create: { key: "oauth.google.clientSecret", encryptedValue: encryptSecret("fake-client-secret") },
    update: { encryptedValue: encryptSecret("fake-client-secret") },
  });

  await page.goto("/login");
  const googleButton = page.getByRole("button", { name: "Continue with Google" });
  await expect(googleButton).toBeVisible();
  await expect(
    page.getByText("Google sign-in is currently unavailable. Ask an admin to enable Google OAuth settings."),
  ).not.toBeVisible();

  await googleButton.click();
  await page.waitForURL(/accounts\.google\.com/, { timeout: 15_000 });
});

test("google button does not get stuck on checking after back navigation", async ({ page }) => {
  await prisma.serverSetting.upsert({
    where: { key: "oauth.google.enabled" },
    create: { key: "oauth.google.enabled", encryptedValue: encryptSecret("true") },
    update: { encryptedValue: encryptSecret("true") },
  });
  await prisma.serverSetting.upsert({
    where: { key: "oauth.google.clientId" },
    create: { key: "oauth.google.clientId", encryptedValue: encryptSecret("fake-client-id") },
    update: { encryptedValue: encryptSecret("fake-client-id") },
  });
  await prisma.serverSetting.upsert({
    where: { key: "oauth.google.clientSecret" },
    create: { key: "oauth.google.clientSecret", encryptedValue: encryptSecret("fake-client-secret") },
    update: { encryptedValue: encryptSecret("fake-client-secret") },
  });

  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();

  // Simulate a broken bootstrap refresh during BFCache restore.
  await page.route("**/api/auth/providers", async () => {
    await new Promise(() => {});
  });
  await page.route("**/api/auth/csrf", async () => {
    await new Promise(() => {});
  });

  await page.goto("about:blank");
  await page.goBack();

  // The button should remain usable from its previous known-good state.
  await expect(page.getByText("Checking Google sign-in...")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
});
