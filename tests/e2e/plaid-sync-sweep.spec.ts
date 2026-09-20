import { expect, test } from "@playwright/test";
import { PlaidItemStatus } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { encryptSecret } from "../../src/lib/security";
import { sweepDuePlaidItems } from "../../src/lib/plaid-sync-scheduler";

/**
 * Exercises the background sweep itself, which the unit tests cannot reach — they cover
 * its pure helpers, while the query, the per-bank error handling and the "already synced
 * recently" skip all need a database.
 *
 * No browser: the item is built directly, because the sweep's job starts once a bank is
 * already linked and mapped. The UI path to that state is covered by the other two specs.
 */
async function configurePlaid() {
  for (const [key, value] of [
    ["plaid.enabled", "true"],
    ["plaid.clientId", "sweep-client"],
    ["plaid.secret", "sweep-secret"],
    ["plaid.env", "sandbox"],
  ]) {
    await prisma.serverSetting.upsert({
      where: { key },
      create: { key, encryptedValue: encryptSecret(value) },
      update: { encryptedValue: encryptSecret(value) },
    });
  }
}

async function linkedItem(stamp: string, overrides: { lastSyncedAt?: Date | null; status?: PlaidItemStatus } = {}) {
  const user = await prisma.user.create({
    data: {
      email: `sweep-${stamp}@example.com`,
      displayName: "Sweep User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  const account = await prisma.account.findFirstOrThrow({
    where: { userId: user.id, archived: false, currency: "CAD" },
  });

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 90);
  const item = await prisma.plaidItem.create({
    data: {
      userId: user.id,
      itemId: `sweep-item-${stamp}`,
      accessTokenEnc: encryptSecret(`access-sandbox-sweep-${stamp}`),
      institutionName: "Test Credit Union",
      requestedDays: 90,
      historyCutoff: new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth(), cutoff.getUTCDate())),
      status: overrides.status ?? PlaidItemStatus.ACTIVE,
      lastSyncedAt: overrides.lastSyncedAt ?? null,
    },
  });
  await prisma.plaidAccount.create({
    data: {
      userId: user.id,
      plaidItemId: item.id,
      plaidAccountId: "fake-acct-chequing",
      name: "Everyday Chequing",
      plaidType: "depository",
      plaidSubtype: "checking",
      currency: "CAD",
      accountId: account.id,
    },
  });
  return { user, item, account };
}

test("the sweep stages transactions for a due bank, then leaves it alone until it is due again", async () => {
  const stamp = `${Date.now()}`;
  await configurePlaid();
  const { user, item } = await linkedItem(stamp);

  const first = await sweepDuePlaidItems();
  expect(first.considered).toBeGreaterThanOrEqual(1);
  expect(first.synced).toBeGreaterThanOrEqual(1);
  expect(first.failed).toBe(0);

  // The queue is populated, and — as with a manual sync — nothing reached the log.
  expect(
    await prisma.plaidStagedTransaction.count({
      where: { userId: user.id, status: "NEEDS_REVIEW" },
    }),
  ).toBe(4);
  expect(await prisma.transaction.count({ where: { userId: user.id } })).toBe(0);

  const after = await prisma.plaidItem.findUniqueOrThrow({ where: { id: item.id } });
  expect(after.lastSyncedAt).not.toBeNull();
  expect(after.cursor).not.toBeNull();
  expect(after.initialSyncDoneAt).not.toBeNull();
  // The lock must not survive the sweep, or the bank is stuck until the stale threshold.
  expect(after.syncingSince).toBeNull();

  // Immediately afterwards it is no longer due, so the sweep does not touch it again.
  const second = await sweepDuePlaidItems();
  expect(second.considered).toBe(0);
  expect(second.synced).toBe(0);
});

test("the sweep skips a bank waiting on re-authentication", async () => {
  const stamp = `${Date.now()}-reauth`;
  await configurePlaid();
  const { user } = await linkedItem(stamp, { status: PlaidItemStatus.LOGIN_REQUIRED });

  const summary = await sweepDuePlaidItems();
  // Retrying it hourly would fail every time and achieve nothing but rate-limit pressure;
  // it stays out until the user signs in again.
  expect(
    await prisma.plaidStagedTransaction.count({ where: { userId: user.id } }),
  ).toBe(0);
  expect(summary.failed).toBe(0);
});

// Deliberately not covered here: the "Plaid is not configured" early exit. Asserting it
// means clearing the plaid.* server settings, which are global rather than per-user, and
// doing that mid-run reproducibly broke the two specs that need Plaid configured. A
// two-line early return is not worth destabilising them for.
