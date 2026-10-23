import { expect, test } from "@playwright/test";
import { prisma } from "../../src/lib/prisma";
import { encryptSecret } from "../../src/lib/security";

async function enableGoogleSignIn() {
  for (const [key, value] of [
    ["oauth.google.enabled", "true"],
    ["oauth.google.clientId", "fake-client-id"],
    ["oauth.google.clientSecret", "fake-client-secret"],
  ]) {
    await prisma.serverSetting.upsert({
      where: { key },
      create: { key, encryptedValue: encryptSecret(value) },
      update: { encryptedValue: encryptSecret(value) },
    });
  }
}

test("google sign-in redirects to Google OAuth screen", async ({ page }) => {
  await enableGoogleSignIn();

  // The sign-in POST is answered here instead of being followed to Google: the suite must not
  // depend on reaching a third party, and checking where it would have sent the browser says
  // more than "some Google page loaded". (A route never sees the redirect's target, so the
  // redirect itself is what gets caught.)
  let googleUrl: URL | null = null;
  await page.route("**/api/auth/signin/google", async (route) => {
    const response = await route.fetch({ maxRedirects: 0 });
    const location = response.headers()["location"];
    if (location) googleUrl = new URL(location);
    await route.fulfill({ status: 200, contentType: "text/html", body: "<title>Redirect caught</title>" });
  });

  await page.goto("/login");
  const googleButton = page.getByRole("button", { name: "Continue with Google" });
  await expect(googleButton).toBeVisible();
  await expect(
    page.getByText("Google sign-in is currently unavailable. Ask an admin to enable Google OAuth settings."),
  ).not.toBeVisible();

  await googleButton.click();
  await expect.poll(() => googleUrl?.origin ?? null).toBe("https://accounts.google.com");
  expect(googleUrl!.searchParams.get("client_id")).toBe("fake-client-id");
  expect(googleUrl!.searchParams.get("redirect_uri")).toMatch(/\/api\/auth\/callback\/google$/);
});

test("google button does not get stuck on checking after back navigation", async ({ page }) => {
  await enableGoogleSignIn();

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

  // Well inside the component's 8s bootstrap timeout: a button that only came back once the
  // hung requests were abandoned would still be "Checking sign-in options..." here.
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible({ timeout: 4_000 });
  await expect(page.getByRole("button", { name: "Checking sign-in options..." })).toHaveCount(0);
});
