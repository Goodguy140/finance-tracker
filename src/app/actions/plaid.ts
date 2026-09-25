"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { PlaidItemStatus, PlaidStagedStatus, type User } from "@prisma/client";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { describeActionError } from "@/lib/action-errors";
import { prisma } from "@/lib/prisma";
import { PlaidApiError, type PlaidClient } from "@/lib/plaid/client";
import { checkMappingAllowed } from "@/lib/plaid/mapping";
import { purgePlaidItemData } from "@/lib/plaid/purge";
import { resolveDisplayName } from "@/lib/plaid/ingest";
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
import { syncPlaidItem } from "@/lib/plaid/sync";
import { resolvePlaidWebhookUrl } from "@/lib/plaid/webhook-url";
import { CLEARED_ATTENTION, ensurePlaidItemWebhook } from "@/lib/plaid/webhooks";
import { sweepDuePlaidItems } from "@/lib/plaid-sync-scheduler";
import { scheduleBudgetAlertEmails } from "@/lib/budget-alert-dispatch";
import {
  assertUserOwnsAccount,
  assertUserOwnsCategory,
  categoryKindForTransactionType,
  formAction,
  getFormValue,
  LONG_TRANSACTION_OPTIONS,
  parseJsonField,
} from "./_helpers";

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

/**
 * Turns a failure into something safe to show.
 *
 * Plaid's own message is written for a person and is surfaced verbatim. Anything else goes
 * through `describeActionError`, which deliberately suppresses Prisma messages because
 * they describe internals — these three actions return their error directly rather than
 * going through `formAction`, so without this they would be the one place in the app that
 * leaks a database error to the browser.
 */
function describePlaidFailure(err: unknown): string {
  if (err instanceof PlaidApiError) {
    return err.message || `Plaid rejected the request (${err.errorCode}).`;
  }
  return describeActionError(err);
}

/**
 * Revokes an item we exchanged but are not going to keep.
 *
 * Exchanging a public token creates a billable Item at Plaid whether or not we store it,
 * so refusing a duplicate without this would create exactly the orphaned, billing-forever
 * connection the refusal exists to prevent — and with no local row, nothing would ever
 * point at it again. Best-effort: if the revoke fails the refusal still stands, but the
 * item id is recorded so it can be removed from the Plaid dashboard by hand.
 */
async function discardRedundantItem(client: PlaidClient, accessToken: string): Promise<void> {
  try {
    await client.removeItem(accessToken);
  } catch (err) {
    console.error("[plaid] could not revoke a redundant item; remove it from the Plaid dashboard", err);
  }
}

/**
 * Which update-mode flow to open. `reauth` covers sign-in required, pending expiration and
 * pending disconnect alike — Plaid's fix for all three is the same re-authentication.
 * `accounts` turns on account selection, for NEW_ACCOUNTS_AVAILABLE.
 */
export type PlaidUpdateKind = "reauth" | "accounts";

function parseUpdateKind(raw: string): PlaidUpdateKind {
  return raw === "accounts" ? "accounts" : "reauth";
}

export type PlaidLinkTokenState =
  | { ok: null }
  | { ok: true; linkToken: string; mode: "create"; cutoffNote: string | null }
  | {
      ok: true;
      linkToken: string;
      mode: "update";
      cutoffNote: null;
      plaidItemId: string;
      updateKind: PlaidUpdateKind;
    }
  | { ok: false; error: string; code?: MfaStepUpCode };

/**
 * Mints the short-lived token Plaid Link needs in the browser.
 *
 * Two modes: a fresh link carries `days_requested` (set once, for the life of the item),
 * and update mode re-authenticates an existing item and must omit products entirely.
 * Both carry this deployment's webhook URL when it has a public one.
 */
export async function createPlaidLinkTokenAction(
  _prev: PlaidLinkTokenState,
  formData: FormData,
): Promise<PlaidLinkTokenState> {
  const gate = await requireStepUp();
  if ("error" in gate) return { ok: false, error: gate.error, code: gate.code };
  const user = gate.user;
  const reauthItemId = getFormValue(formData, "plaidItemId");
  const updateKind = parseUpdateKind(getFormValue(formData, "updateKind"));
  const webhook = resolvePlaidWebhookUrl() ?? undefined;

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
        accountSelection: updateKind === "accounts",
        webhook,
      });
      await recordAuditLog(prisma, {
        userId: user.id,
        action: AUDIT_ACTIONS.plaid_link_started,
        targetType: "PlaidItem",
        targetId: item.id,
        metadata: { mode: "update", updateKind, institution: item.institutionName },
        headers: await headers(),
      });
      return {
        ok: true,
        linkToken: token.link_token,
        mode: "update",
        cutoffNote: null,
        plaidItemId: item.id,
        updateKind,
      };
    }

    const days = parseHistoryWindowDays(getFormValue(formData, "historyDays"));
    const cutoff = resolveHistoryCutoff(days, user.timezone);
    const token = await client.createLinkToken({
      clientUserId: user.id,
      clientName: "Finance Tracker",
      countryCodes: [user.countryCode || "CA"],
      daysRequested: days,
      webhook,
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
      await discardRedundantItem(client, exchanged.access_token);
      return { ok: false, error: "That bank connection is already linked to another account here." };
    }

    // Plaid issues a fresh item_id every time Link completes, so connecting the same bank
    // a second time does NOT collide on `itemId` — it silently creates a second Item, and
    // Plaid bills per Item per month. Re-authenticating an existing connection is what the
    // user almost always meant, so refuse and point them at it.
    if (item?.institution_id) {
      const sameInstitution = await prisma.plaidItem.findFirst({
        where: { userId: user.id, institutionId: item.institution_id },
        select: { institutionName: true },
      });
      if (sameInstitution) {
        await discardRedundantItem(client, exchanged.access_token);
        return {
          ok: false,
          error: `${sameInstitution.institutionName ?? "That bank"} is already connected. Use “Sync now” to fetch new transactions, or “Sign in again” if it needs re-authenticating — connecting it twice would bill you for two connections.`,
        };
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
        webhookUrl: resolvePlaidWebhookUrl(),
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

export type PlaidUpdateState =
  | { ok: null }
  | { ok: true; institutionName: string; updateKind: PlaidUpdateKind; newAccounts: number }
  | { ok: false; error: string; code?: MfaStepUpCode };

/**
 * Finishes update mode for an item we already hold.
 *
 * Link hands back a public token here too, but Plaid's guidance is not to exchange it: the
 * access token is unchanged, and exchanging would only mint a credential to throw away.
 * Instead the item is re-read with the token we have, which both proves the repair took
 * and picks up any accounts the user just shared.
 *
 * Clears every prompt the update answers. That is the point of the flow — the callout the
 * user clicked must not still be there when they come back.
 */
export async function completePlaidUpdateAction(
  _prev: PlaidUpdateState,
  formData: FormData,
): Promise<PlaidUpdateState> {
  const gate = await requireStepUp();
  if ("error" in gate) return { ok: false, error: gate.error, code: gate.code };
  const user = gate.user;
  const plaidItemId = getFormValue(formData, "plaidItemId");
  const updateKind = parseUpdateKind(getFormValue(formData, "updateKind"));

  const item = await prisma.plaidItem.findFirst({ where: { id: plaidItemId, userId: user.id } });
  if (!item) return { ok: false, error: "That bank connection was not found." };

  try {
    const client = await requirePlaidClient();
    const { accounts, item: fresh } = await client.getAccounts(openAccessToken(item));
    const known = await prisma.plaidAccount.count({
      where: { plaidItemId: item.id, plaidAccountId: { in: accounts.map((a) => a.account_id) } },
    });
    await upsertPlaidAccounts(item.id, user.id, accounts);
    await prisma.plaidItem.update({
      where: { id: item.id },
      data: {
        ...CLEARED_ATTENTION,
        // Account selection is also a full update-mode pass, so it clears a sign-in prompt
        // as well; a plain re-auth leaves a new-accounts prompt for its own flow.
        ...(updateKind === "accounts" ? { newAccountsAvailableAt: null } : {}),
        consentExpiresAt: fresh?.consent_expiration_time ? new Date(fresh.consent_expiration_time) : null,
      },
    });
    await recordAuditLog(prisma, {
      userId: user.id,
      action: AUDIT_ACTIONS.plaid_item_update_completed,
      targetType: "PlaidItem",
      targetId: item.id,
      metadata: { updateKind, institution: item.institutionName, accounts: accounts.length },
      headers: await headers(),
    });
    revalidatePath(SETTINGS_PATH);
    revalidatePath("/");
    return {
      ok: true,
      institutionName: item.institutionName ?? "Your bank",
      updateKind,
      newAccounts: Math.max(0, accounts.length - known),
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
 * the badge says the link is gone rather than implying it is still live, and stripped of
 * their Plaid ids. Everything else synced from this bank is deleted (`purgePlaidItemData`).
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

  await prisma.$transaction((tx) => purgePlaidItemData(tx, item));

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

/** Runs a sync for one bank now. Nothing enters the log — rows land in the review queue. */
export const syncPlaidItemAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const plaidItemId = getFormValue(formData, "plaidItemId");
  const item = await prisma.plaidItem.findFirst({
    where: { id: plaidItemId, userId: user.id },
    select: { id: true, institutionName: true },
  });
  if (!item) throw new Error("That bank connection was not found.");

  const client = await requirePlaidClient();
  const { createSyncStore } = await import("@/lib/plaid/sync-store");
  await ensurePlaidItemWebhook({ prisma, client }, item.id);

  try {
    const summary = await syncPlaidItem({ client, store: createSyncStore() }, item.id);
    await recordAuditLog(prisma, {
      userId: user.id,
      action: AUDIT_ACTIONS.plaid_item_sync_succeeded,
      targetType: "PlaidItem",
      targetId: item.id,
      metadata: {
        institution: item.institutionName,
        staged: summary.staged,
        pages: summary.pages,
        skippedUnmapped: summary.skipped.unmapped,
        skippedBeforeCutoff: summary.skipped.beforeCutoff,
      },
      headers: await headers(),
    });
  } catch (err) {
    const needsReauth = err instanceof PlaidApiError && err.needsReauth;
    await recordAuditLog(prisma, {
      userId: user.id,
      action: needsReauth
        ? AUDIT_ACTIONS.plaid_item_reauth_required
        : AUDIT_ACTIONS.plaid_item_sync_failed,
      targetType: "PlaidItem",
      targetId: item.id,
      metadata: { institution: item.institutionName, error: describePlaidFailure(err) },
      headers: await headers(),
    });
    if (needsReauth) {
      throw new Error(
        `${item.institutionName ?? "Your bank"} needs you to sign in again before it will share new transactions. Use “Sign in again” on the bank below.`,
      );
    }
    throw new Error(describePlaidFailure(err));
  }

  revalidatePath("/");
  revalidatePath(SETTINGS_PATH);
});

/**
 * Syncs every one of this user's banks that is due.
 *
 * Deliberately respects the same interval the background sweep uses, rather than forcing a
 * fetch: with several banks connected, a button that ignored it would let someone spend
 * their Plaid rate limit on a row of connections that were refreshed minutes ago. Banks
 * already up to date are simply left alone, and their "Last sync" chip says so.
 */
export const syncAllPlaidItemsAction = formAction(async (formData: FormData) => {
  void formData;
  const user = await requireUser();
  const summary = await sweepDuePlaidItems(new Date(), { userId: user.id });

  if (summary.synced > 0) {
    await recordAuditLog(prisma, {
      userId: user.id,
      action: AUDIT_ACTIONS.plaid_item_sync_succeeded,
      metadata: { mode: "sync-all", banks: summary.synced, staged: summary.staged },
      headers: await headers(),
    });
  }

  revalidatePath("/");
  revalidatePath(SETTINGS_PATH);
});

/**
 * Commits one reviewed row: link it to a transaction the user already entered, add it as
 * a new one, or ignore it.
 *
 * Not gated on a passkey. Linking a bank is a standing grant and is; approving a single
 * transaction is ordinary bookkeeping, and a prompt per row would make the queue unusable.
 */
export const resolveStagedTransactionAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const stagedId = getFormValue(formData, "stagedId");
  const decision = getFormValue(formData, "decision");
  const categoryId = getFormValue(formData, "categoryId");
  const linkTransactionId = getFormValue(formData, "linkTransactionId");

  const staged = await prisma.plaidStagedTransaction.findFirst({
    where: { id: stagedId, userId: user.id },
    include: { plaidItem: { select: { id: true, institutionName: true } } },
  });
  if (!staged) throw new Error("That synced transaction was not found.");
  if (staged.status !== PlaidStagedStatus.NEEDS_REVIEW) {
    throw new Error("That synced transaction has already been reviewed.");
  }

  if (decision === "ignore") {
    await prisma.plaidStagedTransaction.update({
      where: { id: staged.id },
      data: { status: PlaidStagedStatus.IGNORED, resolvedAt: new Date() },
    });
    revalidatePath("/");
    return;
  }

  const resolvedCategoryId = categoryId || staged.suggestedCategoryId;
  if (!resolvedCategoryId) throw new Error("Choose a category for this transaction.");
  await assertUserOwnsCategory(user.id, resolvedCategoryId, categoryKindForTransactionType(staged.type));
  if (staged.suggestedAccountId) await assertUserOwnsAccount(user.id, staged.suggestedAccountId);

  const verificationBase = {
    userId: user.id,
    plaidTransactionId: staged.plaidTransactionId,
    plaidItemId: staged.plaidItem.id,
    plaidAccountRowId: staged.plaidAccountRowId,
    institutionName: staged.plaidItem.institutionName,
  };

  await prisma.$transaction(async (tx) => {
    if (decision === "link") {
      const target = await tx.transaction.findFirst({
        where: { id: linkTransactionId, userId: user.id },
        include: { verification: true },
      });
      if (!target) throw new Error("The transaction to link to was not found.");
      if (target.verification) {
        throw new Error("That transaction is already confirmed against another bank record.");
      }
      if (target.type !== staged.type) {
        throw new Error("An expense cannot be linked to an income entry.");
      }

      await tx.transactionVerification.create({
        data: { ...verificationBase, transactionId: target.id, source: "MATCHED" },
      });
      // The bank's posted date is better information than none, but the amount, category
      // and title the user chose are left exactly as they are.
      if (!target.postedDate && (staged.postedDate || staged.date)) {
        await tx.transaction.update({
          where: { id: target.id },
          data: { postedDate: staged.postedDate ?? staged.date },
        });
      }
      await tx.plaidStagedTransaction.update({
        where: { id: staged.id },
        data: {
          status: PlaidStagedStatus.LINKED,
          resolvedTransactionId: target.id,
          resolvedAt: new Date(),
        },
      });
      return;
    }

    if (decision !== "add") throw new Error("Choose whether to link, add, or ignore this row.");

    const created = await tx.transaction.create({
      data: {
        userId: user.id,
        accountId: staged.suggestedAccountId,
        categoryId: resolvedCategoryId,
        type: staged.type,
        amountCents: staged.amountCents,
        date: staged.date,
        postedDate: staged.postedDate,
        title: resolveDisplayName(staged.name, staged.merchantName),
      },
      select: { id: true },
    });
    await tx.transactionVerification.create({
      data: { ...verificationBase, transactionId: created.id, source: "IMPORTED" },
    });
    await tx.plaidStagedTransaction.update({
      where: { id: staged.id },
      data: {
        status: PlaidStagedStatus.ADDED,
        resolvedTransactionId: created.id,
        resolvedAt: new Date(),
      },
    });
  });

  scheduleBudgetAlertEmails(user.id);
  revalidatePath("/");
});

/** Adds every unmatched row of one bank in a single step. */
export const bulkAddStagedTransactionsAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const stagedIds = parseJsonField<string[]>(
    getFormValue(formData, "stagedIdsJson"),
    [],
    "The selected transactions could not be read. Reload and try again.",
  );
  if (stagedIds.length === 0) return;

  const rows = await prisma.plaidStagedTransaction.findMany({
    where: { id: { in: stagedIds }, userId: user.id, status: PlaidStagedStatus.NEEDS_REVIEW },
    include: { plaidItem: { select: { id: true, institutionName: true } } },
  });

  // A row with no suggested category cannot be written -- Transaction.categoryId is
  // non-nullable. Refusing the batch beats silently adding fewer rows than the button
  // promised, which is invisible to the person who pressed it.
  const uncategorised = rows.filter((row) => !row.suggestedCategoryId);
  if (uncategorised.length > 0) {
    throw new Error(
      `${uncategorised.length} of these have no category yet. Open each one and pick a category, or add them individually.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    for (const staged of rows) {
      const created = await tx.transaction.create({
        data: {
          userId: user.id,
          accountId: staged.suggestedAccountId,
          categoryId: staged.suggestedCategoryId!,
          type: staged.type,
          amountCents: staged.amountCents,
          date: staged.date,
          postedDate: staged.postedDate,
          title: resolveDisplayName(staged.name, staged.merchantName),
        },
        select: { id: true },
      });
      await tx.transactionVerification.create({
        data: {
          userId: user.id,
          transactionId: created.id,
          source: "IMPORTED",
          plaidTransactionId: staged.plaidTransactionId,
          plaidItemId: staged.plaidItem.id,
          plaidAccountRowId: staged.plaidAccountRowId,
          institutionName: staged.plaidItem.institutionName,
        },
      });
      await tx.plaidStagedTransaction.update({
        where: { id: staged.id },
        data: {
          status: PlaidStagedStatus.ADDED,
          resolvedTransactionId: created.id,
          resolvedAt: new Date(),
        },
      });
    }
  }, LONG_TRANSACTION_OPTIONS);

  await recordAuditLog(prisma, {
    userId: user.id,
    action: AUDIT_ACTIONS.plaid_transactions_committed,
    metadata: { added: rows.length },
    headers: await headers(),
  });

  scheduleBudgetAlertEmails(user.id);
  revalidatePath("/");
});

/** Applies the bank's revised values to a transaction the user already committed. */
export const applyBankRevisionAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const stagedId = getFormValue(formData, "stagedId");
  const staged = await prisma.plaidStagedTransaction.findFirst({
    where: { id: stagedId, userId: user.id },
  });
  if (!staged?.resolvedTransactionId) throw new Error("That revision was not found.");

  await prisma.$transaction(async (tx) => {
    await tx.transaction.updateMany({
      where: { id: staged.resolvedTransactionId!, userId: user.id },
      data: {
        amountCents: staged.amountCents,
        date: staged.date,
        postedDate: staged.postedDate,
      },
    });
    await tx.plaidStagedTransaction.update({
      where: { id: staged.id },
      data: { revisedAfterResolveAt: null },
    });
  });

  scheduleBudgetAlertEmails(user.id);
  revalidatePath("/");
});

/** Dismisses a revision, keeping what the user originally approved. */
export const dismissBankRevisionAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const stagedId = getFormValue(formData, "stagedId");
  const updated = await prisma.plaidStagedTransaction.updateMany({
    where: { id: stagedId, userId: user.id },
    data: { revisedAfterResolveAt: null },
  });
  if (updated.count === 0) throw new Error("That revision was not found.");
  revalidatePath("/");
});
