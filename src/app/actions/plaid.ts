"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { PlaidItemStatus, type User } from "@prisma/client";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { prisma } from "@/lib/prisma";
import { PlaidApiError } from "@/lib/plaid/client";
import { checkMappingAllowed } from "@/lib/plaid/mapping";
import {
  makePlaidItemRevoker,
  openAccessToken,
  requirePlaidClient,
  sealAccessToken,
} from "@/lib/plaid/service";
import {
  describeHistoryWindow,
  historyWindowLabel,
  parseHistoryWindowDays,
  resolveHistoryCutoff,
} from "@/lib/plaid/window";
import { formatDateOnlyUtc } from "@/lib/date-only";
import { MfaStepUpRequiredError, requireFreshMfa, requireUser, type MfaStepUpCode } from "@/lib/session";
import { formAction, getFormValue } from "./_helpers";

const SETTINGS_PATH = "/settings";

/**
 * Linking a bank hands this server a standing credential for someone's account — the same
 * bar as minting an API token or linking an SSO identity, and exactly what
 * `requireFreshMfa` was written for (see its docstring in session.ts). Approving an
 * individual synced transaction is not gated: a passkey prompt per row would make the
 * review queue unusable, and nothing there is a standing grant.
 */
async function requireStepUp(): Promise<{ user: User } | { error: string; code: MfaStepUpCode }> {
  try {
    // Returns the already-loaded user rather than making callers hit the session again.
    const loaded = await requireFreshMfa();
    return { user: loaded.user };
  } catch (err) {
    if (err instanceof MfaStepUpRequiredError) return { error: err.message, code: err.code };
    throw err;
  }
}

function describePlaidFailure(err: unknown): string {
  if (err instanceof PlaidApiError) {
    return err.message || `Plaid rejected the request (${err.errorCode}).`;
  }
  return err instanceof Error ? err.message : "Something went wrong talking to Plaid.";
}

export type PlaidLinkTokenState =
  | { ok: null }
  | { ok: true; linkToken: string; mode: "create" | "update"; cutoffNote: string | null }
  | { ok: false; error: string; code?: MfaStepUpCode };

/**
 * Mints the short-lived token Plaid Link needs in the browser.
 *
 * Two modes: a fresh link carries `days_requested` (set once, for the life of the item),
 * and update mode re-authenticates an existing item and must omit products entirely.
 */
export async function createPlaidLinkTokenAction(
  _prev: PlaidLinkTokenState,
  formData: FormData,
): Promise<PlaidLinkTokenState> {
  const gate = await requireStepUp();
  if ("error" in gate) return { ok: false, error: gate.error, code: gate.code };
  const user = gate.user;
  const reauthItemId = getFormValue(formData, "plaidItemId");

  try {
    const client = await requirePlaidClient();

    if (reauthItemId) {
      const item = await prisma.plaidItem.findFirst({
        where: { id: reauthItemId, userId: user.id },
      });
      if (!item) return { ok: false, error: "That bank connection was not found." };
      const token = await client.createLinkToken({
        clientUserId: user.id,
        clientName: "Finance Tracker",
        countryCodes: [user.countryCode || "CA"],
        accessToken: openAccessToken(item),
      });
      await recordAuditLog(prisma, {
        userId: user.id,
        action: AUDIT_ACTIONS.plaid_link_started,
        targetType: "PlaidItem",
        targetId: item.id,
        metadata: { mode: "update", institution: item.institutionName },
        headers: await headers(),
      });
      return { ok: true, linkToken: token.link_token, mode: "update", cutoffNote: null };
    }

    const days = parseHistoryWindowDays(getFormValue(formData, "historyDays"));
    const cutoff = resolveHistoryCutoff(days, user.timezone);
    const token = await client.createLinkToken({
      clientUserId: user.id,
      clientName: "Finance Tracker",
      countryCodes: [user.countryCode || "CA"],
      daysRequested: days,
    });
    await recordAuditLog(prisma, {
      userId: user.id,
      action: AUDIT_ACTIONS.plaid_link_started,
      metadata: { mode: "create", requestedDays: days },
      headers: await headers(),
    });
    return {
      ok: true,
      linkToken: token.link_token,
      mode: "create",
      cutoffNote: describeHistoryWindow(days, cutoff),
    };
  } catch (err) {
    return { ok: false, error: describePlaidFailure(err) };
  }
}

export type PlaidExchangeState =
  | { ok: null }
  | { ok: true; institutionName: string; accountCount: number; cutoffDisplay: string }
  | { ok: false; error: string; code?: MfaStepUpCode };

/**
 * Trades the browser's one-time public token for a long-lived access token and records
 * the item plus its accounts.
 *
 * `historyCutoff` is resolved here, once, and never recomputed — the UI reads the stored
 * value so what the user was promised cannot drift as days pass.
 */
export async function exchangePlaidPublicTokenAction(
  _prev: PlaidExchangeState,
  formData: FormData,
): Promise<PlaidExchangeState> {
  const gate = await requireStepUp();
  if ("error" in gate) return { ok: false, error: gate.error, code: gate.code };
  const user = gate.user;
  const publicToken = getFormValue(formData, "publicToken");
  if (!publicToken) return { ok: false, error: "Plaid did not return a token. Try connecting again." };

  const days = parseHistoryWindowDays(getFormValue(formData, "historyDays"));

  try {
    const client = await requirePlaidClient();
    const exchanged = await client.exchangePublicToken(publicToken);
    const [{ accounts, item }, existing] = await Promise.all([
      client.getAccounts(exchanged.access_token),
      prisma.plaidItem.findUnique({ where: { itemId: exchanged.item_id } }),
    ]);

    // Re-authentication of an item we already hold: refresh the credential and clear the
    // error state, but leave the history window and cursor exactly as they were. Widening
    // the window here would silently pull history the user never asked for.
    if (existing && existing.userId === user.id) {
      await prisma.plaidItem.update({
        where: { id: existing.id },
        data: {
          accessTokenEnc: sealAccessToken(exchanged.access_token),
          status: PlaidItemStatus.ACTIVE,
          errorCode: null,
          errorMessage: null,
          lastSyncError: null,
          consentExpiresAt: item?.consent_expiration_time
            ? new Date(item.consent_expiration_time)
            : null,
        },
      });
      await upsertPlaidAccounts(existing.id, user.id, accounts);
      await recordAuditLog(prisma, {
        userId: user.id,
        action: AUDIT_ACTIONS.plaid_item_linked,
        targetType: "PlaidItem",
        targetId: existing.id,
        metadata: { mode: "reauth", institution: existing.institutionName, accounts: accounts.length },
        headers: await headers(),
      });
      revalidatePath(SETTINGS_PATH);
      return {
        ok: true,
        institutionName: existing.institutionName ?? "Your bank",
        accountCount: accounts.length,
        cutoffDisplay: formatDateOnlyUtc(existing.historyCutoff),
      };
    }

    if (existing) {
      // The same bank item cannot belong to two accounts on one deployment.
      return { ok: false, error: "That bank connection is already linked to another account here." };
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

    const cutoff = resolveHistoryCutoff(days, user.timezone);
    const created = await prisma.plaidItem.create({
      data: {
        userId: user.id,
        itemId: exchanged.item_id,
        accessTokenEnc: sealAccessToken(exchanged.access_token),
        institutionId: item?.institution_id ?? null,
        institutionName,
        requestedDays: days,
        historyCutoff: cutoff,
        consentExpiresAt: item?.consent_expiration_time
          ? new Date(item.consent_expiration_time)
          : null,
      },
      select: { id: true },
    });
    await upsertPlaidAccounts(created.id, user.id, accounts);

    await recordAuditLog(prisma, {
      userId: user.id,
      action: AUDIT_ACTIONS.plaid_item_linked,
      targetType: "PlaidItem",
      targetId: created.id,
      metadata: {
        mode: "create",
        institution: institutionName,
        requestedDays: days,
        historyWindow: historyWindowLabel(days),
        accounts: accounts.length,
      },
      headers: await headers(),
    });

    revalidatePath(SETTINGS_PATH);
    return {
      ok: true,
      institutionName: institutionName ?? "Your bank",
      accountCount: accounts.length,
      cutoffDisplay: formatDateOnlyUtc(cutoff),
    };
  } catch (err) {
    return { ok: false, error: describePlaidFailure(err) };
  }
}

/** Records the accounts inside an item. Never clears a mapping the user already made. */
async function upsertPlaidAccounts(
  plaidItemId: string,
  userId: string,
  accounts: Array<{
    account_id: string;
    name: string;
    official_name?: string | null;
    mask?: string | null;
    type: string;
    subtype?: string | null;
    balances?: { iso_currency_code?: string | null; unofficial_currency_code?: string | null };
  }>,
): Promise<void> {
  for (const account of accounts) {
    const currency =
      account.balances?.iso_currency_code ?? account.balances?.unofficial_currency_code ?? null;
    await prisma.plaidAccount.upsert({
      where: { userId_plaidAccountId: { userId, plaidAccountId: account.account_id } },
      create: {
        userId,
        plaidItemId,
        plaidAccountId: account.account_id,
        name: account.name,
        officialName: account.official_name ?? null,
        mask: account.mask ?? null,
        plaidType: account.type,
        plaidSubtype: account.subtype ?? null,
        currency,
      },
      // Metadata only. `accountId` and `syncEnabled` are the user's choices and are not
      // touched by a re-link or a re-authentication.
      update: {
        plaidItemId,
        name: account.name,
        officialName: account.official_name ?? null,
        mask: account.mask ?? null,
        plaidType: account.type,
        plaidSubtype: account.subtype ?? null,
        currency,
      },
    });
  }
}

/** Points one Plaid account at an app account, or clears the mapping when given "". */
export const mapPlaidAccountAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const plaidAccountRowId = getFormValue(formData, "plaidAccountRowId");
  const accountId = getFormValue(formData, "accountId");

  const plaidAccount = await prisma.plaidAccount.findFirst({
    where: { id: plaidAccountRowId, userId: user.id },
  });
  if (!plaidAccount) throw new Error("That bank account was not found.");

  if (!accountId) {
    await prisma.plaidAccount.update({
      where: { id: plaidAccount.id },
      data: { accountId: null },
    });
    revalidatePath(SETTINGS_PATH);
    return;
  }

  const account = await prisma.account.findFirst({ where: { id: accountId, userId: user.id } });
  if (!account) throw new Error("Selected account was not found.");

  const allowed = checkMappingAllowed(
    { id: plaidAccount.id, name: plaidAccount.name, mask: plaidAccount.mask, currency: plaidAccount.currency },
    { id: account.id, name: account.name, currency: account.currency, archived: account.archived },
  );
  if (!allowed.ok) throw new Error(allowed.reason);

  await prisma.plaidAccount.update({
    where: { id: plaidAccount.id },
    data: { accountId: account.id },
  });
  await recordAuditLog(prisma, {
    userId: user.id,
    action: AUDIT_ACTIONS.plaid_account_mapped,
    targetType: "PlaidAccount",
    targetId: plaidAccount.id,
    metadata: { plaidAccount: plaidAccount.name, account: account.name },
    headers: await headers(),
  });
  revalidatePath(SETTINGS_PATH);
});

export type PlaidUnlinkState =
  | { ok: null }
  | { ok: true; institutionName: string }
  | { ok: false; error: string; code?: MfaStepUpCode };

/**
 * Disconnects a bank — at Plaid first, locally second.
 *
 * The order is the whole point. Deleting the row without calling /item/remove leaves the
 * item live at Plaid, still billing and still holding access to the account, with nothing
 * left pointing at it. If Plaid refuses, nothing is deleted and the user is told.
 *
 * Verifications on already-imported transactions survive, stamped with `itemRemovedAt` so
 * the badge says the link is gone rather than implying it is still live.
 */
export async function unlinkPlaidItemAction(
  _prev: PlaidUnlinkState,
  formData: FormData,
): Promise<PlaidUnlinkState> {
  const gate = await requireStepUp();
  if ("error" in gate) return { ok: false, error: gate.error, code: gate.code };
  const user = gate.user;
  const plaidItemId = getFormValue(formData, "plaidItemId");
  const item = await prisma.plaidItem.findFirst({ where: { id: plaidItemId, userId: user.id } });
  if (!item) return { ok: false, error: "That bank connection was not found." };

  try {
    const client = await requirePlaidClient();
    await makePlaidItemRevoker(client)(item);
  } catch (err) {
    await recordAuditLog(prisma, {
      userId: user.id,
      action: AUDIT_ACTIONS.plaid_item_unlink_failed,
      targetType: "PlaidItem",
      targetId: item.id,
      // The Plaid item id is recorded so an operator can remove it by hand if it comes to
      // that. It is an identifier, not a credential.
      metadata: { institution: item.institutionName, plaidItemId: item.itemId },
      headers: await headers(),
    });
    return {
      ok: false,
      error: `${describePlaidFailure(err)} Nothing was disconnected — the bank connection is still live at Plaid, so it was left in place rather than hidden from you.`,
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.transactionVerification.updateMany({
      where: { userId: user.id, plaidItemId: item.id, itemRemovedAt: null },
      data: { itemRemovedAt: new Date() },
    });
    await tx.plaidStagedTransaction.deleteMany({ where: { userId: user.id, plaidItemId: item.id } });
    await tx.plaidAccount.deleteMany({ where: { userId: user.id, plaidItemId: item.id } });
    await tx.plaidItem.delete({ where: { id: item.id } });
  });

  await recordAuditLog(prisma, {
    userId: user.id,
    action: AUDIT_ACTIONS.plaid_item_unlinked,
    targetType: "PlaidItem",
    targetId: item.id,
    metadata: { institution: item.institutionName },
    headers: await headers(),
  });

  revalidatePath(SETTINGS_PATH);
  revalidatePath("/");
  return { ok: true, institutionName: item.institutionName ?? "Your bank" };
}
