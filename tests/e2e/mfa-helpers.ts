import { expect, type Page } from "@playwright/test";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { hashTestPassword, signInWithPassword, uniqueStamp } from "./helpers";
import { resolveLegacySettingsHash } from "../../src/lib/settings-sections";

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
  const email = `${prefix}-${uniqueStamp()}@example.com`;
  const password = "e2e-password-123";
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword(password),
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
  await signInWithPassword(page, email, password);
  // The form signs in asynchronously; wait for the redirect (dashboard or the /mfa wall)
  // before the caller navigates anywhere else.
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

export async function logout(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await page.waitForURL(/\/login/);
}

/**
 * Opens a Settings page by its old tab name ("security", "integrations"...), which now each
 * have their own URL. Same mapping the app uses to redirect old `/settings#...` links.
 * Loads the dashboard first so its own `?month=` bootstrap navigation, which can still be
 * pending right after a sign-in lands there, has finished and cannot interrupt this one.
 */
export async function openSettingsTab(page: Page, tab: string) {
  await page.goto("/");
  await page.goto(resolveLegacySettingsHash(`#${tab}`) ?? `/settings/${tab}`);
}

/** Enrols the first passkey through the Settings UI and returns the recovery codes shown once. */
export async function enrolFirstPasskey(page: Page, password: string, name = "E2E virtual passkey") {
  await openSettingsTab(page, "security");
  const security = page.locator("#security");
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
