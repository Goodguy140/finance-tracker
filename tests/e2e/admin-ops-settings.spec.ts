import { expect, test, type Page } from "@playwright/test";
import { hash } from "bcryptjs";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { decryptSecret } from "../../src/lib/security";
import { expectDashboardHome } from "./expect-dashboard-home";
import { uniqueStamp } from "./helpers";

const PASSWORD = "e2e-password-123";

/**
 * `ServerSetting` rows are global to the whole suite, and every spec runs twice in parallel
 * (desktop and mobile projects). So this writes one fixed value that both copies agree on,
 * never deletes, and never flips a switch another spec depends on.
 */
const RETENTION_DAYS = "400";

async function createAdmin(email: string) {
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hash(PASSWORD, 12),
      displayName: "E2E Ops Admin",
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

test("an admin can change audit retention from Operations, and the change is audited", async ({ page }) => {
  const email = `ops-admin-${uniqueStamp()}@example.com`;
  const user = await createAdmin(email);
  await signIn(page, email);

  await page.goto("/settings/admin/operations");
  const retention = page.getByRole("region", { name: "Audit log retention" });
  await retention.getByRole("spinbutton").fill(RETENTION_DAYS);
  await page.getByRole("button", { name: "Save operations settings" }).click();

  // Polled on the audit row, which the action writes last (see AGENTS.md).
  await expect
    .poll(
      async () => prisma.auditLog.count({ where: { action: "admin_ops_settings_updated", userId: user.id } }),
      { timeout: 10_000 },
    )
    .toBe(1);

  const row = await prisma.serverSetting.findUnique({ where: { key: "ops.auditRetentionDays" } });
  expect(row ? decryptSecret(row.encryptedValue) : null).toBe(RETENTION_DAYS);

  const audit = await prisma.auditLog.findFirst({
    where: { action: "admin_ops_settings_updated", userId: user.id },
  });
  expect(audit?.metadataJson ?? "").toContain(`"to":"${RETENTION_DAYS}"`);

  // The audit page reports the retention actually in effect.
  await page.goto("/settings/admin/audit");
  await expect(page.getByText(`Entries are kept for ${RETENTION_DAYS} days`)).toBeVisible();
});

test("an out-of-range retention is refused and nothing is written", async ({ page }) => {
  const email = `ops-admin-bad-${uniqueStamp()}@example.com`;
  const user = await createAdmin(email);
  await signIn(page, email);

  await page.goto("/settings/admin/operations");
  const input = page.getByRole("region", { name: "Audit log retention" }).getByRole("spinbutton");
  // Bypass the browser's own min/max check so the server-side validation is what runs.
  await input.evaluate((el: HTMLInputElement) => {
    el.removeAttribute("min");
    el.form?.setAttribute("novalidate", "");
  });
  await input.fill("5");
  await page.getByRole("button", { name: "Save operations settings" }).click();

  await expect(page.getByText(/between 30 and 3650 days/)).toBeVisible();
  expect(await prisma.auditLog.count({ where: { action: "admin_ops_settings_updated", userId: user.id } })).toBe(0);
});
