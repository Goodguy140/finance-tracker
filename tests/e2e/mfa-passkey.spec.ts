import { expect, test } from "@playwright/test";
import { expectDashboardHome } from "./expect-dashboard-home";
import {
  addVirtualAuthenticator,
  seedUser,
  enrolFirstPasskey,
  loginWithPassword,
  logout,
  openSettingsTab,
} from "./mfa-helpers";

test.describe("passkey MFA", () => {
  test("enrolling a passkey makes every later password login pass through the /mfa wall", async ({ page }) => {
    await addVirtualAuthenticator(page);
    const account = await seedUser("e2e-mfa");

    await loginWithPassword(page, account.email, account.password);
    await expectDashboardHome(page);
    await enrolFirstPasskey(page, account.password);
    await logout(page);

    await loginWithPassword(page, account.email, account.password);
    await page.waitForURL(/\/mfa/);
    await expect(page.getByRole("heading", { name: "Confirm it’s you" })).toBeVisible();

    // The same cookie that is parked on the wall must not pull the account out via the API.
    const exportRes = await page.request.get("/api/backup/export/me");
    expect(exportRes.status()).toBe(403);
    // Nor reach a protected page directly.
    await page.goto("/settings");
    await page.waitForURL(/\/mfa\?next=%2Fsettings/);

    await page.getByRole("button", { name: "Use passkey" }).click();
    await page.waitForURL(/\/settings/);
    await expect(page.getByRole("region", { name: "You" })).toBeVisible();
    expect((await page.request.get("/api/backup/export/me")).status()).toBe(200);
  });

  test("a passkey signs in on its own and the session is already verified", async ({ page }) => {
    await addVirtualAuthenticator(page);
    const account = await seedUser("e2e-pwl");
    await loginWithPassword(page, account.email, account.password);
    await enrolFirstPasskey(page, account.password);
    await logout(page);

    await page.goto("/login");
    await page.getByRole("button", { name: "Sign in with a passkey" }).click();
    await expectDashboardHome(page);
    expect(page.url()).not.toMatch(/\/mfa/);
  });

  test("a recovery code passes the wall once and unlocks replacing a lost passkey", async ({ page }) => {
    const { cdp, authenticatorId } = await addVirtualAuthenticator(page);
    const account = await seedUser("e2e-rec");
    await loginWithPassword(page, account.email, account.password);
    const codes = await enrolFirstPasskey(page, account.password);
    await logout(page);

    // Simulate the lost device.
    await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });

    await loginWithPassword(page, account.email, account.password);
    await page.waitForURL(/\/mfa/);
    await page.getByRole("button", { name: "Lost your passkey? Use a recovery code" }).click();
    await page.getByPlaceholder("xxxxx-xxxxx").fill("aaaaa-aaaaa");
    await page.getByRole("button", { name: "Use recovery code" }).click();
    await expect(page.getByText(/not valid or was already used/)).toBeVisible();

    await page.getByPlaceholder("xxxxx-xxxxx").fill(codes[0]);
    await page.getByRole("button", { name: "Use recovery code" }).click();
    await expectDashboardHome(page);

    // Recovery counts as step-up for a few minutes: the lost passkey can be removed.
    await openSettingsTab(page, "security");
    await expect(page.getByText("7 unused codes remaining.")).toBeVisible();
    await page.getByRole("button", { name: "Remove" }).click();
    // Confirmed in the page's own dialog, not the browser's.
    await page.getByRole("dialog", { name: /Remove passkey/ }).getByRole("button", { name: "Remove passkey" }).click();
    await expect(page.getByText("No passkeys yet.")).toBeVisible();

    // The used code is spent.
    await logout(page);
    await loginWithPassword(page, account.email, account.password);
    await expectDashboardHome(page); // MFA is off again with no passkeys left
  });

  test("API tokens need a passkey: blocked without one, minted after a fresh enrolment", async ({ page }) => {
    await addVirtualAuthenticator(page);
    const account = await seedUser("e2e-tok");
    await loginWithPassword(page, account.email, account.password);

    await openSettingsTab(page, "integrations");
    const panel = page.getByRole("region", { name: "API tokens" });
    await expect(panel.getByText("Creating a token requires a passkey.")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Create token" })).toBeDisabled();

    await enrolFirstPasskey(page, account.password);

    await openSettingsTab(page, "integrations");
    await panel.getByPlaceholder("e.g. Life Dashboard").fill("Dashboard");
    await panel.getByRole("button", { name: "Create token" }).click();
    await expect(panel.getByText(/Token “Dashboard” created/)).toBeVisible();
  });
});
