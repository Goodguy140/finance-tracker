import { expect, test, type Page } from "@playwright/test";
import { hash } from "bcryptjs";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { signFakePlaidWebhook } from "../../src/lib/plaid/fake-webhook";
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
      displayName: "E2E Webhook User",
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

/**
 * Delivers a webhook the way Plaid does: signed, over the exact body bytes. Uses the page's
 * request context but sends no session cookie that matters — the route must accept it on
 * the signature alone.
 */
async function deliver(page: Page, body: Record<string, unknown>) {
  const raw = JSON.stringify(body);
  const response = await page.request.post("/api/plaid/webhook", {
    data: raw,
    headers: { "content-type": "application/json", "plaid-verification": signFakePlaidWebhook(raw) },
  });
  expect(response.status()).toBe(200);
}

/**
 * Waits for the audit row, which is the last thing each webhook or update writes — waiting
 * on the item row instead would read the gap before the audit (and, for LOGIN_REPAIRED,
 * before the consent refresh).
 */
async function waitForAudit(targetId: string, action: string, count: number) {
  await expect
    .poll(async () => prisma.auditLog.count({ where: { targetId, action } }), { timeout: 15_000 })
    .toBe(count);
}

test("Plaid item webhooks raise prompts, and update mode or LOGIN_REPAIRED clears them", async ({ page }) => {
  await addVirtualAuthenticator(page);
  const stamp = uniqueStamp();
  const email = `plaid-webhook-${stamp}@example.com`;
  await configurePlaidForTests();
  const user = await createUser(email);

  await signIn(page, email);
  await expectDashboardHome(page);
  await enrolFirstPasskey(page, PASSWORD);

  await openSettingsTab(page, "accounts");
  let panel = page.getByRole("region", { name: "Connected banks" });
  await panel.getByRole("button", { name: "Connect a bank" }).click();
  await expect(panel.getByText(/Connected to Test Credit Union/i)).toBeVisible({ timeout: 15_000 });
  const item = await prisma.plaidItem.findFirstOrThrow({ where: { userId: user.id } });
  await expect(panel.getByTestId("plaid-attention")).toHaveCount(0);

  // --- an unsigned delivery is refused and changes nothing ---
  const forged = await page.request.post("/api/plaid/webhook", {
    data: JSON.stringify({ webhook_type: "ITEM", webhook_code: "NEW_ACCOUNTS_AVAILABLE", item_id: item.itemId }),
    headers: { "content-type": "application/json" },
  });
  expect(forged.status()).toBe(401);
  expect((await prisma.plaidItem.findUniqueOrThrow({ where: { id: item.id } })).newAccountsAvailableAt).toBeNull();

  // --- ITEM_LOGIN_REQUIRED → prompt → update mode clears it ---
  await deliver(page, {
    webhook_type: "ITEM",
    webhook_code: "ERROR",
    item_id: item.itemId,
    error: { error_code: "ITEM_LOGIN_REQUIRED", error_type: "ITEM_ERROR" },
  });
  await waitForAudit(item.id, "plaid_item_reauth_required", 1);

  await page.goto("/");
  await expect(page.getByTestId("plaid-attention-banner")).toContainText(/bank connection needs your attention/i);

  await openSettingsTab(page, "banks");
  panel = page.getByRole("region", { name: "Connected banks" });
  const callout = panel.getByTestId("plaid-attention");
  await expect(callout).toHaveAttribute("data-attention-kind", "reauth");
  await expect(panel.getByText("Sign-in needed")).toBeVisible();
  await callout.getByRole("button", { name: "Sign in again" }).click();

  await waitForAudit(item.id, "plaid_item_update_completed", 1);
  await expect(panel.getByText(/Updated Test Credit Union/i)).toBeVisible({ timeout: 15_000 });
  await expect(panel.getByTestId("plaid-attention")).toHaveCount(0);
  const reauthed = await prisma.plaidItem.findUniqueOrThrow({ where: { id: item.id } });
  expect(reauthed.status).toBe("ACTIVE");
  expect(reauthed.errorCode).toBeNull();

  // --- PENDING_EXPIRATION → prompt → LOGIN_REPAIRED clears it without the user ---
  await deliver(page, {
    webhook_type: "ITEM",
    webhook_code: "PENDING_EXPIRATION",
    item_id: item.itemId,
    consent_expiration_time: new Date(Date.now() + 5 * 86_400_000).toISOString(),
  });
  await waitForAudit(item.id, "plaid_webhook_received", 1);
  await page.reload();
  await expect(panel.getByTestId("plaid-attention")).toHaveAttribute("data-attention-kind", "expiring");
  await expect(panel.getByText("Action needed")).toBeVisible();

  await deliver(page, { webhook_type: "ITEM", webhook_code: "LOGIN_REPAIRED", item_id: item.itemId });
  await waitForAudit(item.id, "plaid_webhook_received", 2);
  await page.reload();
  await expect(panel.getByText("Connected", { exact: true })).toBeVisible();
  await expect(panel.getByTestId("plaid-attention")).toHaveCount(0);

  // --- NEW_ACCOUNTS_AVAILABLE → account-selection update mode adds the account ---
  await deliver(page, { webhook_type: "ITEM", webhook_code: "NEW_ACCOUNTS_AVAILABLE", item_id: item.itemId });
  await waitForAudit(item.id, "plaid_webhook_received", 3);
  await page.reload();
  const newAccounts = panel.getByTestId("plaid-attention");
  await expect(newAccounts).toHaveAttribute("data-attention-kind", "new-accounts");
  await newAccounts.getByRole("button", { name: "Add new accounts" }).click();

  await waitForAudit(item.id, "plaid_item_update_completed", 2);
  await expect(panel.getByText(/1 new account added/i)).toBeVisible({ timeout: 15_000 });
  await expect(panel.getByTestId("plaid-attention")).toHaveCount(0);
  await expect(page.getByLabel("Send Tax-Free Savings transactions to")).toBeVisible();
  expect((await prisma.plaidItem.findUniqueOrThrow({ where: { id: item.id } })).newAccountsAvailableAt).toBeNull();

  await page.goto("/");
  await expectDashboardHome(page);
  await expect(page.getByTestId("plaid-attention-banner")).toHaveCount(0);
});

test("Consent revoked at Plaid deletes what was synced under it, and keeps the user's transactions", async ({ page }) => {
  await addVirtualAuthenticator(page);
  const stamp = uniqueStamp();
  const email = `plaid-revoked-${stamp}@example.com`;
  await configurePlaidForTests();
  const user = await createUser(email);

  await signIn(page, email);
  await expectDashboardHome(page);
  await enrolFirstPasskey(page, PASSWORD);

  await openSettingsTab(page, "accounts");
  const panel = page.getByRole("region", { name: "Connected banks" });
  await panel.getByRole("button", { name: "Connect a bank" }).click();
  await expect(panel.getByText(/Connected to Test Credit Union/i)).toBeVisible({ timeout: 15_000 });
  const item = await prisma.plaidItem.findFirstOrThrow({ where: { userId: user.id } });
  const plaidAccounts = await prisma.plaidAccount.findMany({ where: { plaidItemId: item.id }, orderBy: { name: "asc" } });
  expect(plaidAccounts.length).toBeGreaterThan(1);
  const [revokedAccount, keptAccount] = plaidAccounts;

  // One committed, verified transaction and one queued row per account — what a sync leaves.
  const category = await prisma.category.findFirstOrThrow({ where: { userId: user.id, kind: "EXPENSE" } });
  const verified = [];
  for (const [i, account] of [revokedAccount, keptAccount].entries()) {
    const transaction = await prisma.transaction.create({
      data: { userId: user.id, categoryId: category.id, type: "EXPENSE", amountCents: 1000 + i, date: new Date() },
    });
    await prisma.transactionVerification.create({
      data: {
        userId: user.id,
        transactionId: transaction.id,
        source: "IMPORTED",
        plaidTransactionId: `txn-${stamp}-${i}`,
        plaidItemId: item.id,
        plaidAccountRowId: account.id,
        institutionName: item.institutionName,
      },
    });
    await prisma.plaidStagedTransaction.create({
      data: {
        userId: user.id,
        plaidItemId: item.id,
        plaidAccountRowId: account.id,
        plaidTransactionId: `queued-${stamp}-${i}`,
        name: "Corner Store",
        amountCents: 500,
        type: "EXPENSE",
        date: new Date(),
      },
    });
    verified.push(transaction.id);
  }

  // --- one account withdrawn: that account's data goes, the connection stays ---
  await deliver(page, {
    webhook_type: "ITEM",
    webhook_code: "USER_ACCOUNT_REVOKED",
    item_id: item.itemId,
    account_id: revokedAccount.plaidAccountId,
  });
  await waitForAudit(item.id, "plaid_account_consent_revoked", 1);
  expect(await prisma.plaidAccount.count({ where: { id: revokedAccount.id } })).toBe(0);
  expect(await prisma.plaidStagedTransaction.count({ where: { plaidAccountRowId: revokedAccount.id } })).toBe(0);
  expect(await prisma.plaidStagedTransaction.count({ where: { plaidAccountRowId: keptAccount.id } })).toBe(1);
  const accountScrubbed = await prisma.transactionVerification.findUniqueOrThrow({ where: { transactionId: verified[0] } });
  expect(accountScrubbed).toMatchObject({ plaidTransactionId: null, plaidItemId: null, plaidAccountRowId: null });
  expect(await prisma.plaidItem.count({ where: { id: item.id } })).toBe(1);

  // --- the whole connection withdrawn: everything synced goes, the transactions stay ---
  await deliver(page, { webhook_type: "ITEM", webhook_code: "USER_PERMISSION_REVOKED", item_id: item.itemId });
  await waitForAudit(item.id, "plaid_item_consent_revoked", 1);
  expect(await prisma.plaidItem.count({ where: { id: item.id } })).toBe(0);
  expect(await prisma.plaidAccount.count({ where: { plaidItemId: item.id } })).toBe(0);
  expect(await prisma.plaidStagedTransaction.count({ where: { userId: user.id } })).toBe(0);
  expect(await prisma.transaction.count({ where: { id: { in: verified } } })).toBe(2);
  const itemScrubbed = await prisma.transactionVerification.findUniqueOrThrow({ where: { transactionId: verified[1] } });
  expect(itemScrubbed).toMatchObject({
    plaidTransactionId: null,
    plaidItemId: null,
    plaidAccountRowId: null,
    institutionName: item.institutionName,
  });
  expect(itemScrubbed.itemRemovedAt).not.toBeNull();

  await page.reload();
  await expect(panel.getByText("Test Credit Union")).toHaveCount(0);
});
