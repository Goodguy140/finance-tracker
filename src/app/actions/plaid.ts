"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import type { User } from "@prisma/client";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { describeActionError } from "@/lib/action-errors";
import { prisma } from "@/lib/prisma";
import { PlaidApiError } from "@/lib/plaid/client";
import { checkMappingAllowed } from "@/lib/plaid/mapping";
import {
  addStagedRows,
  applyStagedRevision,
  decideStagedRow,
  dismissStagedRevision,
  ignoreStagedRows,
  linkStagedRows,
  pairStagedTransfers,
  parseCountAs,
  type StagedDecision,
} from "@/lib/plaid/review-decisions";
import {
  completeUpdate,
  ConnectionStillLiveError,
  endConnection,
  linkBank,
  type PlaidUpdateKind,
  setPlaidAccountMapping,
} from "@/lib/plaid/connections";
import { openAccessToken, requirePlaidClient } from "@/lib/plaid/service";
import {
  describeHistoryWindow,
  historyWindowLabel,
  parseHistoryWindowDays,
  resolveHistoryCutoff,
} from "@/lib/plaid/window";
import { formatDateOnlyUtc } from "@/lib/date-only";
import { MfaStepUpRequiredError, requireFreshMfa, requireUser, type MfaStepUpCode } from "@/lib/session";
import { createSyncBankDeps, syncBank } from "@/lib/plaid/sync-bank";
import { resolvePlaidWebhookUrl } from "@/lib/plaid/webhook-url";
import { sweepDuePlaidItems, type SweepSummary } from "@/lib/plaid-sync-scheduler";
import { describeLogRefresh, LOG_REFRESH_INTERVAL_MINUTES, type LogRefreshResult } from "@/lib/plaid/log-refresh";
import type { ActionFailure } from "@/lib/action-result";
import { formAction, getFormValue, parseJsonField } from "./_helpers";

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

export type { PlaidUpdateKind };

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
    const outcome = await linkBank(
      { prisma, client: await requirePlaidClient() },
      { user, publicToken, days },
    );

    if (outcome.kind === "refused") {
      return {
        ok: false,
        error:
          outcome.reason === "linked-elsewhere"
            ? "That bank connection is already linked to another account here."
            : `${outcome.institutionName ?? "That bank"} is already connected. Use “Sync now” to fetch new transactions, or “Sign in again” if it needs re-authenticating — connecting it twice would bill you for two connections.`,
      };
    }

    await recordAuditLog(prisma, {
      userId: user.id,
      action: AUDIT_ACTIONS.plaid_item_linked,
      targetType: "PlaidItem",
      targetId: outcome.plaidItemId,
      metadata:
        outcome.mode === "reauth"
          ? { mode: "reauth", institution: outcome.institutionName, accounts: outcome.accountCount }
          : {
              mode: "create",
              institution: outcome.institutionName,
              requestedDays: days,
              historyWindow: historyWindowLabel(days),
              accounts: outcome.accountCount,
            },
      headers: await headers(),
    });

    revalidatePath(SETTINGS_PATH, "layout");
    return {
      ok: true,
      institutionName: outcome.institutionName ?? "Your bank",
      accountCount: outcome.accountCount,
      cutoffDisplay: formatDateOnlyUtc(outcome.historyCutoff),
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
    const { accountCount, newAccounts } = await completeUpdate(
      { prisma, client: await requirePlaidClient() },
      item,
      updateKind,
    );
    await recordAuditLog(prisma, {
      userId: user.id,
      action: AUDIT_ACTIONS.plaid_item_update_completed,
      targetType: "PlaidItem",
      targetId: item.id,
      metadata: { updateKind, institution: item.institutionName, accounts: accountCount },
      headers: await headers(),
    });
    revalidatePath(SETTINGS_PATH, "layout");
    revalidatePath("/");
    return {
      ok: true,
      institutionName: item.institutionName ?? "Your bank",
      updateKind,
      newAccounts,
    };
  } catch (err) {
    return { ok: false, error: describePlaidFailure(err) };
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
    await setPlaidAccountMapping(prisma, plaidAccount, null);
    revalidatePath(SETTINGS_PATH, "layout");
    return;
  }

  const account = await prisma.account.findFirst({ where: { id: accountId, userId: user.id } });
  if (!account) throw new Error("Selected account was not found.");

  const allowed = checkMappingAllowed(
    { id: plaidAccount.id, name: plaidAccount.name, mask: plaidAccount.mask, currency: plaidAccount.currency },
    { id: account.id, name: account.name, currency: account.currency, archived: account.archived },
  );
  if (!allowed.ok) throw new Error(allowed.reason);

  await setPlaidAccountMapping(prisma, plaidAccount, account.id);
  await recordAuditLog(prisma, {
    userId: user.id,
    action: AUDIT_ACTIONS.plaid_account_mapped,
    targetType: "PlaidAccount",
    targetId: plaidAccount.id,
    metadata: { plaidAccount: plaidAccount.name, account: account.name },
    headers: await headers(),
  });
  revalidatePath(SETTINGS_PATH, "layout");
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
    await endConnection({ prisma, client: await requirePlaidClient() }, item);
  } catch (err) {
    if (!(err instanceof ConnectionStillLiveError)) throw err;
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
      error: `${describePlaidFailure(err.cause)} Nothing was disconnected — the bank connection is still live at Plaid, so it was left in place rather than hidden from you.`,
    };
  }

  await recordAuditLog(prisma, {
    userId: user.id,
    action: AUDIT_ACTIONS.plaid_item_unlinked,
    targetType: "PlaidItem",
    targetId: item.id,
    metadata: { institution: item.institutionName },
    headers: await headers(),
  });

  revalidatePath(SETTINGS_PATH, "layout");
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

  const outcome = await syncBank(await createSyncBankDeps(), item.id);

  if (outcome.kind === "synced") {
    await recordAuditLog(prisma, {
      userId: user.id,
      action: AUDIT_ACTIONS.plaid_item_sync_succeeded,
      targetType: "PlaidItem",
      targetId: item.id,
      metadata: {
        institution: item.institutionName,
        staged: outcome.summary.staged,
        pages: outcome.summary.pages,
        skippedUnmapped: outcome.summary.skipped.unmapped,
        skippedBeforeCutoff: outcome.summary.skipped.beforeCutoff,
      },
      headers: await headers(),
    });
  } else {
    const needsReauth = outcome.kind === "needs-reauth";
    await recordAuditLog(prisma, {
      userId: user.id,
      action: needsReauth
        ? AUDIT_ACTIONS.plaid_item_reauth_required
        : AUDIT_ACTIONS.plaid_item_sync_failed,
      targetType: "PlaidItem",
      targetId: item.id,
      metadata: { institution: item.institutionName, error: describePlaidFailure(outcome.error) },
      headers: await headers(),
    });
    if (needsReauth) {
      throw new Error(
        `${item.institutionName ?? "Your bank"} needs you to sign in again before it will share new transactions. Use “Sign in again” on the bank below.`,
      );
    }
    throw new Error(describePlaidFailure(outcome.error));
  }

  revalidatePath("/");
  revalidatePath(SETTINGS_PATH, "layout");
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
  revalidatePath(SETTINGS_PATH, "layout");
});

/**
 * The refresh control on the transaction log. Checks every one of this user's banks not
 * checked in the last few minutes and says what came of it (`describeLogRefresh`).
 *
 * Returns its result rather than going through `formAction`, because the point of the
 * control is the sentence it shows next to the icon, and a void action has nothing to say.
 */
export async function refreshLinkedAccountsAction(): Promise<LogRefreshResult | ActionFailure> {
  const user = await requireUser();
  let summary: SweepSummary;
  try {
    summary = await sweepDuePlaidItems(new Date(), {
      userId: user.id,
      intervalMinutes: LOG_REFRESH_INTERVAL_MINUTES,
    });
  } catch (err) {
    console.error("[plaid] refresh from the log failed", err);
    return { ok: false, error: describePlaidFailure(err) };
  }

  if (summary.synced > 0) {
    await recordAuditLog(prisma, {
      userId: user.id,
      action: AUDIT_ACTIONS.plaid_item_sync_succeeded,
      metadata: { mode: "log-refresh", banks: summary.synced, staged: summary.staged },
      headers: await headers(),
    });
    revalidatePath("/");
    revalidatePath(SETTINGS_PATH, "layout");
  }

  return describeLogRefresh(summary);
}

function parseStagedIds(formData: FormData): string[] {
  const ids = parseJsonField<unknown>(
    getFormValue(formData, "stagedIdsJson"),
    [],
    "The selected transactions could not be read. Reload and try again.",
  );
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
    throw new Error("The selected transactions could not be read. Reload and try again.");
  }
  return [...new Set(ids as string[])];
}

// The queue's decisions live in `src/lib/plaid/review-decisions.ts`, shared with the phone
// app's `/api/v1/review-queue` routes; these actions read the form and refresh the page.

function parseDecision(formData: FormData): StagedDecision {
  switch (getFormValue(formData, "decision")) {
    case "ignore":
      return { decision: "ignore" };
    case "link":
      return { decision: "link", transactionId: getFormValue(formData, "linkTransactionId") };
    case "add":
      return {
        decision: "add",
        countAs: parseCountAs(getFormValue(formData, "countAs")),
        categoryId: getFormValue(formData, "categoryId"),
      };
    default:
      throw new Error("Choose whether to link, add, or ignore this row.");
  }
}

/** Commits one reviewed row: link it to a transaction the user already entered, add it as a new one, or ignore it. */
export const resolveStagedTransactionAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  await decideStagedRow(user.id, getFormValue(formData, "stagedId"), parseDecision(formData));
  revalidatePath("/");
});

/** Adds two bank rows as the two legs of one transfer. */
export const pairStagedTransfersAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  await pairStagedTransfers(user.id, getFormValue(formData, "stagedId"), getFormValue(formData, "peerStagedId"));
  revalidatePath("/");
});

/** "Add all" unmatched rows, the ticked rows, or the ticked rows in one chosen category. */
export const bulkAddStagedTransactionsAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const stagedIds = parseStagedIds(formData);
  if (stagedIds.length === 0) return;
  const added = await addStagedRows(user.id, stagedIds, getFormValue(formData, "categoryId") || null);
  await recordAuditLog(prisma, {
    userId: user.id,
    action: AUDIT_ACTIONS.plaid_transactions_committed,
    metadata: { added },
    headers: await headers(),
  });
  revalidatePath("/");
});

/** Ignores the rows ticked in the queue. Rows someone already decided are left as they are. */
export const bulkIgnoreStagedTransactionsAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  await ignoreStagedRows(user.id, parseStagedIds(formData));
  revalidatePath("/");
});

/** Links each row to the entry the matcher paired it with ("Link all strong matches"). */
export const bulkLinkStagedTransactionsAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const links = parseJsonField<unknown>(
    getFormValue(formData, "linksJson"),
    [],
    "The matches could not be read. Reload and try again.",
  );
  if (
    !Array.isArray(links) ||
    links.some((l) => typeof l?.stagedId !== "string" || typeof l?.transactionId !== "string")
  ) {
    throw new Error("The matches could not be read. Reload and try again.");
  }
  await linkStagedRows(user.id, links as { stagedId: string; transactionId: string }[]);
  revalidatePath("/");
});

/** Applies the bank's revised values to a transaction the user already committed. */
export const applyBankRevisionAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  await applyStagedRevision(user.id, getFormValue(formData, "stagedId"));
  revalidatePath("/");
});

/** Dismisses a revision, keeping what the user originally approved. */
export const dismissBankRevisionAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  await dismissStagedRevision(user.id, getFormValue(formData, "stagedId"));
  revalidatePath("/");
});
