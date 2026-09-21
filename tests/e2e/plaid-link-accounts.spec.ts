import { expect, test, type Page } from "@playwright/test";
import { hash } from "bcryptjs";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { configurePlaidForTests } from "./plaid-helpers";
import { expectDashboardHome } from "./expect-dashboard-home";
import { uniqueStamp } from "./helpers";
import { addVirtualAuthenticator, enrolFirstPasskey, openSettingsTab } from "./mfa-helpers";

const PASSWORD = "e2e-password-123";

async function createUser(email: string) {
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hash(PASSWORD, 12),
      displayName: "E2E Bank User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
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
}

test("connecting a bank records the item, maps accounts, refuses a currency mismatch, and unlinking revokes it", async ({
  page,
}) => {
  await addVirtualAuthenticator(page);
  const stamp = uniqueStamp();
  const email = `plaid-link-${stamp}@example.com`;
  await configurePlaidForTests();
  const user = await createUser(email);

  await signIn(page, email);
  await expectDashboardHome(page);

  // Linking a bank is gated on a fresh passkey assertion, the same bar as minting an API
  // token — so the account needs one before the button does anything.
  await enrolFirstPasskey(page, PASSWORD);

  await openSettingsTab(page, "accounts");
  const panel = page.getByRole("region", { name: "Connected banks" });
  await expect(panel).toBeVisible();

  // The sandbox warning must be unmissable: everything connected here is fake.
  await expect(panel.getByText(/sandbox/i)).toBeVisible();

  // The chosen window is stated as an exact date, not a vague "2 years".
  await panel.getByLabel("How far back to fetch").selectOption("730");
  await panel.getByRole("button", { name: "Connect a bank" }).click();

  await expect(panel.getByText(/Connected to Test Credit Union/i)).toBeVisible({ timeout: 15_000 });
  // The confirmation names the exact date history reaches back to, not a vague window.
  await expect(
    panel.getByText(/3 accounts found\. Transactions back to \w{3}, \w{3} \d{1,2}, \d{4}/i),
  ).toBeVisible();

  const item = await prisma.plaidItem.findFirstOrThrow({ where: { userId: user.id } });
  expect(item.requestedDays).toBe(730);
  expect(item.institutionName).toBe("Test Credit Union");
  // The access token is a live bank credential and must never be stored in the clear.
  expect(item.accessTokenEnc).not.toContain("access-sandbox");
  expect(item.cursor).toBeNull();

  // The stored cutoff matches what the user was told, and is UTC midnight like every
  // other calendar date here.
  expect(item.historyCutoff.getUTCHours()).toBe(0);

  const plaidAccounts = await prisma.plaidAccount.findMany({
    where: { userId: user.id },
    orderBy: { name: "asc" },
  });
  expect(plaidAccounts).toHaveLength(3);
  // Nothing syncs until the user says where it goes.
  expect(plaidAccounts.every((a) => a.accountId === null)).toBe(true);

  // --- mapping a matching-currency account succeeds ---
  const appAccount = await prisma.account.findFirstOrThrow({
    where: { userId: user.id, archived: false, currency: "CAD" },
  });
  // Each mapping select carries its own aria-label, which is the stable handle here.
  const chequingSelect = page.getByLabel("Send Everyday Chequing transactions to");
  await chequingSelect.selectOption(appAccount.id);
  await chequingSelect.locator("..").getByRole("button", { name: "Save" }).click();

  await expect
    .poll(async () => {
      const row = await prisma.plaidAccount.findFirstOrThrow({
        where: { userId: user.id, plaidAccountId: "fake-acct-chequing" },
      });
      return row.accountId;
    }, { timeout: 10_000 })
    .toBe(appAccount.id);

  // --- mapping a USD card into a CAD account is refused ---
  const cardSelect = page.getByLabel("Send Travel Rewards Card transactions to");
  await cardSelect.selectOption(appAccount.id);
  await cardSelect.locator("..").getByRole("button", { name: "Save" }).click();

  // The refusal explains why rather than failing generically: there is no FX layer, so
  // mixing currencies would silently corrupt every total.
  await expect(page.getByText(/no currency conversion/i)).toBeVisible({ timeout: 10_000 });
  const cardAfter = await prisma.plaidAccount.findFirstOrThrow({
    where: { userId: user.id, plaidAccountId: "fake-acct-usd-card" },
  });
  expect(cardAfter.accountId).toBeNull();

  // --- unlinking revokes at Plaid and clears local rows ---
  await page.reload();
  await openSettingsTab(page, "accounts");
  const panelAfter = page.getByRole("region", { name: "Connected banks" });
  await panelAfter.getByRole("button", { name: "Disconnect" }).click();
  await panelAfter.getByRole("button", { name: "Yes, disconnect" }).click();

  await expect
    .poll(async () => prisma.plaidItem.count({ where: { userId: user.id } }), { timeout: 15_000 })
    .toBe(0);
  expect(await prisma.plaidAccount.count({ where: { userId: user.id } })).toBe(0);

  const audit = await prisma.auditLog.findMany({
    where: { userId: user.id, action: { startsWith: "plaid_" } },
    orderBy: { createdAt: "asc" },
  });
  const actions = audit.map((a) => a.action);
  expect(actions).toContain("plaid_link_started");
  expect(actions).toContain("plaid_item_linked");
  expect(actions).toContain("plaid_item_unlinked");
  // The audit trail must never carry the credential itself.
  expect(JSON.stringify(audit)).not.toContain("access-sandbox");
});
