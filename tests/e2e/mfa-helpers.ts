import { expect, type Page } from "@playwright/test";
import { hash } from "bcryptjs";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";

/**
 * Chromium's virtual authenticator (via CDP): a resident, user-verifying "internal"
 * passkey that answers every prompt automatically. It lives for the page's CDP session,
 * so one call covers enrol → sign out → sign in within a test.
 */
export async function addVirtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { cdp, authenticatorId };
}

export async function seedUser(prefix: string) {
  const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const password = "e2e-password-123";
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hash(password, 12),
      displayName: "E2E MFA User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  return { user, email, password };
}

export async function loginWithPassword(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Login", exact: true }).click();
  // The form signs in asynchronously; wait for the redirect (dashboard or the /mfa wall)
  // before the caller navigates anywhere else.
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

export async function logout(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Logout" }).click();
  await page.waitForURL(/\/login/);
}

/**
 * Deep-links a settings tab via its hash from a fresh document load. A hash-only change on
 * an already-open /settings is a same-document navigation that does not reliably re-run
 * the tab sync, and clicking tabs is fragile on the scrolling mobile tab strip.
 */
export async function openSettingsTab(page: Page, hash: string) {
  await page.goto("/");
  await page.goto(`/settings#${hash}`);
}

/** Enrols the first passkey through the Settings UI and returns the recovery codes shown once. */
export async function enrolFirstPasskey(page: Page, password: string, name = "E2E virtual passkey") {
  await openSettingsTab(page, "security");
  const panel = page.getByRole("tabpanel", { name: "Profile" });
  const security = panel.locator("#security");
  await security.getByPlaceholder("MacBook Touch ID").fill(name);
  // LabeledField renders a <span>, not a <label>; the only password field inside #security
  // is the "turn passkeys on" confirmation.
  await security.locator('input[type="password"]').fill(password);
  await security.getByRole("button", { name: "Add passkey" }).click();

  const dialog = page.getByRole("dialog", { name: "Save your recovery codes" });
  await expect(dialog).toBeVisible();
  const codes = await dialog.locator("li").allTextContents();
  expect(codes).toHaveLength(8);
  await dialog.getByRole("button", { name: "I saved them" }).click();

  await page.waitForURL(/\/settings/);
  await expect(page.getByText("Passkey sign-in is on.")).toBeVisible();
  return codes;
}
