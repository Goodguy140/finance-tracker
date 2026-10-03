import type { Prisma, PrismaClient } from "@prisma/client";
import type { PlaidClient } from "@/lib/plaid/client";
import { attentionCleared, newAccountsHandled, parseConsentExpiry } from "@/lib/plaid/item-state";
import { purgePlaidItemData } from "@/lib/plaid/purge";
import { makePlaidItemRevoker, openAccessToken, sealAccessToken } from "@/lib/plaid/service";
import type { PlaidApiAccount } from "@/lib/plaid/types";
import { resolvePlaidWebhookUrl } from "@/lib/plaid/webhook-url";
import { resolveHistoryCutoff } from "@/lib/plaid/window";

/**
 * Starting, repairing and ending a bank connection.
 *
 * This is where Plaid's billing rules live, because every one of them is about these three
 * moments (see AGENTS.md, "Plaid integration"):
 *
 *  - exchanging a public token creates a billable Item whether or not it is kept, so every
 *    refusal after an exchange also removes the Item at Plaid (`discardRedundantItem`);
 *  - Plaid issues a fresh item_id each time Link completes, so linking the same institution
 *    twice is caught by institution, not by item id;
 *  - ending a connection means `/item/remove` first and deleting second, and nothing is
 *    deleted if the removal fails.
 *
 * Nothing here knows about sessions, forms, audit rows or cache revalidation; the server
 * actions and the webhook route do that around it. That keeps the rules testable against the
 * fake client and a real database (`connections.test.ts`).
 */

export type ConnectionDeps = {
  prisma: PrismaClient;
  client: PlaidClient;
};

type Db = PrismaClient | Prisma.TransactionClient;

/** Records the accounts inside an item. Never clears a mapping the user already made. */
export async function upsertPlaidAccounts(
  db: Db,
  plaidItemId: string,
  userId: string,
  accounts: readonly PlaidApiAccount[],
): Promise<void> {
  for (const account of accounts) {
    const currency =
      account.balances?.iso_currency_code ?? account.balances?.unofficial_currency_code ?? null;
    const metadata = {
      plaidItemId,
      name: account.name,
      officialName: account.official_name ?? null,
      mask: account.mask ?? null,
      plaidType: account.type,
      plaidSubtype: account.subtype ?? null,
      currency,
    };
    await db.plaidAccount.upsert({
      where: { userId_plaidAccountId: { userId, plaidAccountId: account.account_id } },
      create: { userId, plaidAccountId: account.account_id, ...metadata },
      // Metadata only. `accountId` and `syncEnabled` are the user's choices and are not
      // touched by a re-link or a re-authentication.
      update: metadata,
    });
  }
}

/**
 * Revokes an item we exchanged but are not going to keep.
 *
 * Without this, refusing a duplicate would create exactly the orphaned, billing-forever
 * connection the refusal exists to prevent, and with no local row nothing would ever point
 * at it again. Best-effort: if the revoke fails the refusal still stands, and the failure is
 * logged so it can be removed from the Plaid dashboard by hand.
 */
async function discardRedundantItem(client: PlaidClient, accessToken: string): Promise<void> {
  try {
    await client.removeItem(accessToken);
  } catch (err) {
    console.error("[plaid] could not revoke a redundant item; remove it from the Plaid dashboard", err);
  }
}

export type LinkBankInput = {
  user: { id: string; countryCode: string | null; timezone: string | null };
  publicToken: string;
  /** How much history was requested when Link opened. */
  days: number;
  now?: Date;
};

export type LinkBankOutcome =
  | {
      kind: "linked";
      /** "reauth" when the exchange named an item this user already holds. */
      mode: "create" | "reauth";
      plaidItemId: string;
      institutionName: string | null;
      accountCount: number;
      historyCutoff: Date;
    }
  /** The item belongs to another user here. It has been removed at Plaid. */
  | { kind: "refused"; reason: "linked-elsewhere" }
  /** This user already has this institution connected. The new item has been removed at Plaid. */
  | { kind: "refused"; reason: "same-institution"; institutionName: string | null };

/**
 * Trades Link's one-time public token for a stored connection and its accounts.
 *
 * `historyCutoff` is resolved here, once, and never recomputed, so what the user was promised
 * cannot drift as days pass.
 */
export async function linkBank(deps: ConnectionDeps, input: LinkBankInput): Promise<LinkBankOutcome> {
  const { prisma, client } = deps;
  const { user, days } = input;
  const exchanged = await client.exchangePublicToken(input.publicToken);
  const [{ accounts, item }, existing] = await Promise.all([
    client.getAccounts(exchanged.access_token),
    prisma.plaidItem.findUnique({ where: { itemId: exchanged.item_id } }),
  ]);

  // Re-authentication of an item we already hold: renew the credential and clear what the
  // user was being asked to fix, but leave the history window and cursor exactly as they
  // were. Widening the window here would silently pull history the user never asked for.
  if (existing && existing.userId === user.id) {
    await prisma.plaidItem.update({
      where: { id: existing.id },
      data: {
        ...attentionCleared(),
        accessTokenEnc: sealAccessToken(exchanged.access_token),
        consentExpiresAt: parseConsentExpiry(item?.consent_expiration_time),
      },
    });
    await upsertPlaidAccounts(prisma, existing.id, user.id, accounts);
    return {
      kind: "linked",
      mode: "reauth",
      plaidItemId: existing.id,
      institutionName: existing.institutionName,
      accountCount: accounts.length,
      historyCutoff: existing.historyCutoff,
    };
  }

  if (existing) {
    // The same bank item cannot belong to two accounts on one deployment.
    await discardRedundantItem(client, exchanged.access_token);
    return { kind: "refused", reason: "linked-elsewhere" };
  }

  // Plaid issues a fresh item_id every time Link completes, so connecting the same bank a
  // second time does NOT collide on `itemId`: it silently creates a second Item, and Plaid
  // bills per Item per month. Re-authenticating the existing connection is what the user
  // almost always meant, so refuse and point them at it.
  if (item?.institution_id) {
    const sameInstitution = await prisma.plaidItem.findFirst({
      where: { userId: user.id, institutionId: item.institution_id },
      select: { institutionName: true },
    });
    if (sameInstitution) {
      await discardRedundantItem(client, exchanged.access_token);
      return { kind: "refused", reason: "same-institution", institutionName: sameInstitution.institutionName };
    }
  }

  let institutionName: string | null = null;
  if (item?.institution_id) {
    try {
      const resolved = await client.getInstitution(item.institution_id, [user.countryCode || "CA"]);
      institutionName = resolved.institution?.name ?? null;
    } catch {
      // A missing display name is cosmetic; it must not fail the link.
      institutionName = null;
    }
  }

  const historyCutoff = resolveHistoryCutoff(days, user.timezone, input.now);
  const created = await prisma.plaidItem.create({
    data: {
      userId: user.id,
      itemId: exchanged.item_id,
      accessTokenEnc: sealAccessToken(exchanged.access_token),
      institutionId: item?.institution_id ?? null,
      institutionName,
      requestedDays: days,
      historyCutoff,
      webhookUrl: resolvePlaidWebhookUrl(),
      consentExpiresAt: parseConsentExpiry(item?.consent_expiration_time),
    },
    select: { id: true },
  });
  await upsertPlaidAccounts(prisma, created.id, user.id, accounts);
  return {
    kind: "linked",
    mode: "create",
    plaidItemId: created.id,
    institutionName,
    accountCount: accounts.length,
    historyCutoff,
  };
}

/**
 * Which update-mode flow ran. `reauth` covers sign-in required, pending expiration and
 * pending disconnect alike, since Plaid's fix for all three is the same re-authentication.
 * `accounts` is account selection, for NEW_ACCOUNTS_AVAILABLE.
 */
export type PlaidUpdateKind = "reauth" | "accounts";

/**
 * Finishes update mode for an item we already hold.
 *
 * Link hands back a public token here too, but Plaid's guidance is not to exchange it: the
 * access token is unchanged, and exchanging would only mint a credential to throw away.
 * Instead the item is re-read with the token we have, which both proves the repair took and
 * picks up any accounts the user just shared. Every prompt the update answers is cleared, so
 * the callout the user clicked is gone when they come back.
 */
export async function completeUpdate(
  deps: ConnectionDeps,
  item: { id: string; userId: string; accessTokenEnc: string },
  updateKind: PlaidUpdateKind,
): Promise<{ accountCount: number; newAccounts: number }> {
  const { prisma, client } = deps;
  const { accounts, item: fresh } = await client.getAccounts(openAccessToken(item));
  const known = await prisma.plaidAccount.count({
    where: { plaidItemId: item.id, plaidAccountId: { in: accounts.map((a) => a.account_id) } },
  });
  await upsertPlaidAccounts(prisma, item.id, item.userId, accounts);
  await prisma.plaidItem.update({
    where: { id: item.id },
    data: {
      ...attentionCleared(),
      // Account selection is also a full update-mode pass, so it clears a sign-in prompt as
      // well; a plain re-auth leaves a new-accounts prompt for its own flow.
      ...(updateKind === "accounts" ? newAccountsHandled() : {}),
      consentExpiresAt: parseConsentExpiry(fresh?.consent_expiration_time),
    },
  });
  return { accountCount: accounts.length, newAccounts: Math.max(0, accounts.length - known) };
}

/**
 * Plaid refused to remove the item, so nothing was deleted here. `cause` is Plaid's error,
 * whose message is written for a person.
 */
export class ConnectionStillLiveError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "ConnectionStillLiveError";
  }
}

/**
 * Ends a connection: removed at Plaid first, then everything synced under it deleted
 * (`purgePlaidItemData`). The order is the whole point. Deleting the row without
 * `/item/remove` leaves the item live at Plaid, still billing and still holding access to the
 * account, with nothing left pointing at it. If Plaid refuses, this throws
 * `ConnectionStillLiveError` and nothing is deleted. An item Plaid has already forgotten
 * counts as removed.
 *
 * The user's committed transactions are never touched; their verification badges survive,
 * stripped of Plaid ids.
 */
export async function endConnection(
  deps: ConnectionDeps,
  item: { id: string; userId: string; itemId: string; accessTokenEnc: string },
  now: Date = new Date(),
): Promise<void> {
  try {
    await makePlaidItemRevoker(deps.client)(item);
  } catch (err) {
    throw new ConnectionStillLiveError(err);
  }
  await deps.prisma.$transaction((tx) => purgePlaidItemData(tx, item, now));
}

