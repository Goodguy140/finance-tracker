import { expect, test } from "@playwright/test";
import { totpCode } from "../../src/lib/totp";
import { expectDashboardHome } from "./expect-dashboard-home";
import { loginWithPassword, logout, openSettingsTab, seedUser } from "./mfa-helpers";

test.describe("authenticator app", () => {
  test("setting one up puts every later password login through the /mfa wall, passed with a code", async ({ page }) => {
    const account = await seedUser("e2e-totp");
    await loginWithPassword(page, account.email, account.password);
    await expectDashboardHome(page);

    await openSettingsTab(page, "security");
    const card = page.getByRole("region", { name: "Authenticator app" });
    await card.locator('input[type="password"]').fill(account.password);
    await card.getByRole("button", { name: "Set up authenticator app" }).click();
    const secret = ((await card.getByTestId("totp-secret").textContent()) ?? "").replace(/\s/g, "");
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    await card.getByPlaceholder("123456").fill(totpCode(secret, Date.now()));
    await card.getByRole("button", { name: "Turn on" }).click();

    const codes = page.getByRole("dialog", { name: "Save your recovery codes" });
    await expect(codes.locator("li")).toHaveCount(8);
    await codes.getByRole("button", { name: "I saved them" }).click();
    await expect(card.getByText(/Authenticator app is on/)).toBeVisible();
    await logout(page);

    await loginWithPassword(page, account.email, account.password);
    await page.waitForURL(/\/mfa/);
    expect((await page.request.get("/api/backup/export/me")).status()).toBe(403);
    // The code used to turn it on cannot be used again; the next one (still within the drift window) can.
    await page.getByPlaceholder("123456").fill(totpCode(secret, Date.now() + 30_000));
    await page.getByRole("button", { name: "Continue" }).click();
    await expectDashboardHome(page);
    expect((await page.request.get("/api/backup/export/me")).status()).toBe(200);
  });
});
