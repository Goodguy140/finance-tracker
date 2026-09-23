import { expect, test, type Page } from "@playwright/test";
import { hash } from "bcryptjs";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { decryptSecret } from "../../src/lib/security";
import { expectDashboardHome } from "./expect-dashboard-home";
import { uniqueStamp } from "./helpers";

const PASSWORD = "e2e-password-123";

async function createAdmin(email: string) {
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hash(PASSWORD, 12),
      displayName: "E2E Plaid Admin",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "SERVER_ADMIN",
    },
  });
  await ensureDefaultDataForUser(user);
  return user;
}

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Login" }).click();
  await expectDashboardHome(page);
}

/** Reads a plaid.* ServerSetting back through the same encryption the server used. */
async function readPlaidSetting(key: string): Promise<string | null> {
  const row = await prisma.serverSetting.findUnique({ where: { key } });
  return row ? decryptSecret(row.encryptedValue) : null;
}

test("an admin can store Plaid credentials, and the secret is encrypted and never rendered back", async ({
  page,
}) => {
  const email = `plaid-admin-${uniqueStamp()}@example.com`;
  const user = await createAdmin(email);
  await signIn(page, email);

  await page.goto("/settings/admin/integrations");
  const section = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Plaid (bank transaction sync)" }),
  });
  await expect(section).toBeVisible();

  // Named, not positional: the section has a second checkbox (the background sweep), and
  // an unqualified getByRole("checkbox") is a strict-mode violation the moment it lands.
  await section.getByRole("checkbox", { name: "Enable Plaid bank sync" }).check();
  await section.getByPlaceholder("Plaid client ID").fill("test-client-id");
  await section.getByPlaceholder("Plaid secret (leave blank to keep)").fill("test-secret-value");
  // Deliberately NOT "production". `plaid.env` is a global server setting shared by every
  // spec, and plaidFakeClientAllowed() refuses the in-memory Plaid unless it reads
  // "sandbox" — so writing production here sent whatever else was mid-run to the real API.
  // That environment round-trips through resolvePlaidSettings, which is unit-tested.
  await section.getByRole("combobox").selectOption("sandbox");
  await section.getByRole("button", { name: "Save Plaid settings" }).click();

  // Polled on the audit row, which the action writes last. Waiting on anything earlier
  // observes the gaps between the action's sequential writes and reads a row that is about
  // to exist as missing — which is how this flaked twice.
  await expect
    .poll(
      async () =>
        prisma.auditLog.count({ where: { action: "plaid_settings_updated", userId: user.id } }),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0);

  expect(await readPlaidSetting("plaid.clientId")).toBe("test-client-id");
  expect(await readPlaidSetting("plaid.secret")).toBe("test-secret-value");
  expect(await readPlaidSetting("plaid.enabled")).toBe("true");
  expect(await readPlaidSetting("plaid.env")).toBe("sandbox");
  // The background sweep ships on, so saving the form with the box untouched stores "true".
  // Switching it off is asserted in the unit tests: `plaid.*` rows are global to the suite
  // and a stored "false" would be visible to every other spec's server process.
  expect(await readPlaidSetting("plaid.syncScheduler")).toBe("true");

  // Stored ciphertext must not contain the plaintext secret.
  const secretRow = await prisma.serverSetting.findUnique({ where: { key: "plaid.secret" } });
  expect(secretRow?.encryptedValue).not.toContain("test-secret-value");

  // The audit trail records the change without the credential values.
  const audit = await prisma.auditLog.findFirst({
    where: { action: "plaid_settings_updated", userId: user.id },
    orderBy: { createdAt: "desc" },
  });
  expect(audit).not.toBeNull();
  expect(audit?.metadataJson ?? "").not.toContain("test-secret-value");
  expect(audit?.metadataJson ?? "").toContain("sandbox");

  // Reloading echoes the client id back but never the secret.
  await page.reload();
  await expect(section.getByPlaceholder("Plaid client ID")).toHaveValue("test-client-id");
  await expect(section.getByPlaceholder("Plaid secret (leave blank to keep)")).toHaveValue("");
  await expect(section.getByRole("combobox")).toHaveValue("sandbox");
  await expect(section.getByRole("checkbox", { name: "Sync connected banks in the background" })).toBeChecked();

  // A blank secret field on re-save keeps the stored secret rather than wiping it.
  await section.getByPlaceholder("Plaid client ID").fill("second-client-id");
  await section.getByRole("button", { name: "Save Plaid settings" }).click();
  await expect
    .poll(
      async () =>
        prisma.auditLog.count({ where: { action: "plaid_settings_updated", userId: user.id } }),
      { timeout: 10_000 },
    )
    .toBe(2);
  expect(await readPlaidSetting("plaid.clientId")).toBe("second-client-id");
  expect(await readPlaidSetting("plaid.secret")).toBe("test-secret-value");
});
