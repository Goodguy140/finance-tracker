"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { CategoryKind, PlaidStagedStatus, TransactionType, type User } from "@prisma/client";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { describeActionError } from "@/lib/action-errors";
import { prisma } from "@/lib/prisma";
import { PlaidApiError } from "@/lib/plaid/client";
import { checkMappingAllowed } from "@/lib/plaid/mapping";
import {
  addStagedRow,
  applyBankRevision,
  COMMITTABLE_STAGED_SELECT,
  dismissBankRevision,
  ignoreStagedRow,
  linkStagedRow,
  loadStagedProposer,
  pairStagedRows,
  toCommittable,
  type PairOutcome,
  type ReviewOutcome,
  type ReviewRefusal,
} from "@/lib/plaid/review";
import {
  completeUpdate,
  ConnectionStillLiveError,
  endConnection,
  linkBank,
  type PlaidUpdateKind,
  setPlaidAccountMapping,
} from "@/lib/plaid/connections";
import { openAccessToken, requirePlaidClient } from "@/lib/plaid/service";
import { defaultStagedType, proposeStagedRowAs } from "@/lib/plaid/staged-rules";
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
import { scheduleBudgetAlertEmails } from "@/lib/budget-alert-dispatch";
import { ensureFallbackCategoryFor } from "@/lib/fallback-categories";
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

/** The message a person sees when a review decision is refused. */
const REVIEW_REFUSALS: Record<ReviewRefusal, string> = {
  "already-reviewed": "That synced transaction has already been reviewed.",
  "target-not-found": "The transaction to link to was not found.",
  "target-verified": "That transaction is already confirmed against another bank record.",
  "type-mismatch": "An expense cannot be linked to an income entry.",
  "not-a-pair":
    "Those two cannot be one transfer: they need the same amount leaving one account and arriving in another, a few days apart at most.",
};

function parseCountAs(value: string): TransactionType | null {
  return value === TransactionType.EXPENSE || value === TransactionType.INCOME || value === TransactionType.TRANSFER
    ? value
    : null;
}

/** Throws inside a database transaction, so a refused decision rolls back everything with it. */
function orRefuse(outcome: ReviewOutcome | PairOutcome): void {
  if (!outcome.ok) throw new Error(REVIEW_REFUSALS[outcome.reason]);
}

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

  const row = await prisma.plaidStagedTransaction.findFirst({
    where: { id: stagedId, userId: user.id },
    select: { ...COMMITTABLE_STAGED_SELECT, status: true, name: true, merchantName: true, suggestedCategoryId: true },
  });
  if (!row) throw new Error("That synced transaction was not found.");
  // Answered early for a clearer message; the claim inside each decision is what enforces it.
  if (row.status !== PlaidStagedStatus.NEEDS_REVIEW) throw new Error(REVIEW_REFUSALS["already-reviewed"]);
  const staged = toCommittable(row);

  if (decision === "ignore") {
    if (!(await ignoreStagedRow(prisma, { userId: user.id, stagedId: staged.id }))) {
      throw new Error(REVIEW_REFUSALS["already-reviewed"]);
    }
    revalidatePath("/");
    return;
  }

  if (decision === "link") {
    await prisma.$transaction(async (tx) =>
      orRefuse(await linkStagedRow(tx, { userId: user.id, staged, transactionId: linkTransactionId })),
    );
  } else if (decision === "add") {
    // The queue can book a row as a transfer or not, whatever the sync guessed.
    const type = parseCountAs(getFormValue(formData, "countAs")) ?? staged.type;
    const proposal = proposeStagedRowAs(await loadStagedProposer(user.id), row, type);
    const resolvedCategoryId =
      type === TransactionType.TRANSFER
        ? await ensureFallbackCategoryFor(prisma, user.id, CategoryKind.TRANSFER)
        : categoryId || proposal.categoryId;
    if (!resolvedCategoryId) throw new Error("Choose a category for this transaction.");
    await assertUserOwnsCategory(user.id, resolvedCategoryId, categoryKindForTransactionType(type));
    if (staged.suggestedAccountId) await assertUserOwnsAccount(user.id, staged.suggestedAccountId);
    await prisma.$transaction(async (tx) =>
      orRefuse(await addStagedRow(tx, { userId: user.id, staged, categoryId: resolvedCategoryId, proposal, type })),
    );
  } else {
    throw new Error("Choose whether to link, add, or ignore this row.");
  }

  scheduleBudgetAlertEmails(user.id);
  revalidatePath("/");
});

/**
 * Adds two bank rows as the two legs of one transfer: the money leaving one account and
 * arriving in the other, each kept out of every total and each naming the other's account.
 */
export const pairStagedTransfersAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const stagedIds = [getFormValue(formData, "stagedId"), getFormValue(formData, "peerStagedId")];
  if (!stagedIds[0] || !stagedIds[1] || stagedIds[0] === stagedIds[1]) {
    throw new Error("Choose the two sides of the transfer.");
  }

  const rows = await prisma.plaidStagedTransaction.findMany({
    where: { id: { in: stagedIds }, userId: user.id },
    select: { ...COMMITTABLE_STAGED_SELECT, status: true, name: true, merchantName: true, suggestedCategoryId: true },
  });
  const ordered = stagedIds.map((id) => rows.find((row) => row.id === id));
  const [a, b] = ordered;
  if (!a || !b) throw new Error("That synced transaction was not found.");
  if (a.status !== PlaidStagedStatus.NEEDS_REVIEW || b.status !== PlaidStagedStatus.NEEDS_REVIEW) {
    throw new Error(REVIEW_REFUSALS["already-reviewed"]);
  }
  for (const row of ordered) {
    if (row?.suggestedAccountId) await assertUserOwnsAccount(user.id, row.suggestedAccountId);
  }

  const propose = await loadStagedProposer(user.id);
  const leg = (row: typeof a) => ({
    staged: toCommittable(row),
    proposal: proposeStagedRowAs(propose, row, TransactionType.TRANSFER),
  });
  const categoryId = await ensureFallbackCategoryFor(prisma, user.id, CategoryKind.TRANSFER);
  await prisma.$transaction(async (tx) =>
    orRefuse(await pairStagedRows(tx, { userId: user.id, legs: [leg(a), leg(b)], categoryId })),
  );
  revalidatePath("/");
});

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

/**
 * Adds several rows in one step: every unmatched row ("Add all"), or the rows ticked in the
 * queue. With `categoryId` ("Add with category") each row is booked as an expense or income in
 * that category, whatever the sync or a rule proposed; the rows must all be of that kind.
 */
export const bulkAddStagedTransactionsAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const stagedIds = parseStagedIds(formData);
  if (stagedIds.length === 0) return;
  const chosenCategoryId = getFormValue(formData, "categoryId") || null;

  const rows = await prisma.plaidStagedTransaction.findMany({
    where: { id: { in: stagedIds }, userId: user.id, status: PlaidStagedStatus.NEEDS_REVIEW },
    select: { ...COMMITTABLE_STAGED_SELECT, name: true, merchantName: true, suggestedCategoryId: true },
  });

  const propose = await loadStagedProposer(user.id);
  let chosenKind: CategoryKind | null = null;
  if (chosenCategoryId) {
    const category = await prisma.category.findFirst({ where: { id: chosenCategoryId, userId: user.id }, select: { kind: true } });
    if (!category || category.kind === CategoryKind.TRANSFER) throw new Error("Choose a category for these transactions.");
    chosenKind = category.kind;
    const mismatched = rows.filter((row) => categoryKindForTransactionType(row.type) !== chosenKind);
    if (mismatched.length > 0) {
      throw new Error(
        `${mismatched.length} of these ${chosenKind === CategoryKind.INCOME ? "are not income" : "are not spending"}, so they can't go in that category. Untick them, or add them on their own.`,
      );
    }
  }
  // Each row as the queue offers it: a rule that marks transfers books its rows as transfers,
  // as the row's ticked "transfer" box would. A chosen category books them as what they are.
  const plans = new Map(
    rows.map((row) => {
      const type = chosenKind ? row.type : defaultStagedType(propose, row);
      return [row.id, { type, proposal: proposeStagedRowAs(propose, row, type) }];
    }),
  );
  // A row a rule turned into a transfer has no category of the right kind from the sync.
  const retyped = (row: (typeof rows)[number]) => plans.get(row.id)!.type !== row.type;
  const transferCategoryId = rows.some(retyped)
    ? await ensureFallbackCategoryFor(prisma, user.id, CategoryKind.TRANSFER)
    : null;
  const categoryFor = (row: (typeof rows)[number]) =>
    chosenCategoryId ?? (retyped(row) ? transferCategoryId : plans.get(row.id)!.proposal.categoryId);

  // A row with no suggested category cannot be written -- Transaction.categoryId is
  // non-nullable. Refusing the batch beats silently adding fewer rows than the button
  // promised, which is invisible to the person who pressed it.
  const uncategorised = rows.filter((row) => !categoryFor(row));
  if (uncategorised.length > 0) {
    throw new Error(
      `${uncategorised.length} of these have no category yet. Open each one and pick a category, or add them individually.`,
    );
  }

  // For the same reason, a row someone else reviewed in the meantime refuses the whole batch
  // rather than quietly shrinking it.
  await prisma.$transaction(async (tx) => {
    for (const row of rows) {
      const { type, proposal } = plans.get(row.id)!;
      orRefuse(
        await addStagedRow(tx, {
          userId: user.id,
          staged: toCommittable(row),
          categoryId: categoryFor(row)!,
          proposal,
          type,
        }),
      );
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

/** Ignores the rows ticked in the queue. Rows someone already decided are left as they are. */
export const bulkIgnoreStagedTransactionsAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const stagedIds = parseStagedIds(formData);
  await prisma.$transaction(async (tx) => {
    for (const stagedId of stagedIds) await ignoreStagedRow(tx, { userId: user.id, stagedId });
  });
  revalidatePath("/");
});

/**
 * Links each row to the entry the matcher paired it with ("Link all strong matches"). The
 * pairs come from the page; `linkStagedRow` checks each one again (ownership, type, an entry
 * already verified), and one refusal rolls the whole batch back.
 */
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
  const pairs = links as { stagedId: string; transactionId: string }[];
  if (pairs.length === 0) return;
  if (new Set(pairs.map((p) => p.transactionId)).size !== pairs.length) {
    throw new Error("Two bank rows matched the same entry. Link those one at a time.");
  }
  const rows = await prisma.plaidStagedTransaction.findMany({
    where: { id: { in: pairs.map((p) => p.stagedId) }, userId: user.id },
    select: COMMITTABLE_STAGED_SELECT,
  });
  const byId = new Map(rows.map((row) => [row.id, toCommittable(row)]));
  await prisma.$transaction(async (tx) => {
    for (const pair of pairs) {
      const staged = byId.get(pair.stagedId);
      if (!staged) throw new Error("That synced transaction was not found.");
      orRefuse(await linkStagedRow(tx, { userId: user.id, staged, transactionId: pair.transactionId }));
    }
  }, LONG_TRANSACTION_OPTIONS);
  revalidatePath("/");
});

/** Applies the bank's revised values to a transaction the user already committed. */
export const applyBankRevisionAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const stagedId = getFormValue(formData, "stagedId");
  const applied = await prisma.$transaction((tx) => applyBankRevision(tx, { userId: user.id, stagedId }));
  if (!applied) throw new Error("That revision was not found.");

  scheduleBudgetAlertEmails(user.id);
  revalidatePath("/");
});

/** Dismisses a revision, keeping what the user originally approved. */
export const dismissBankRevisionAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const stagedId = getFormValue(formData, "stagedId");
  if (!(await dismissBankRevision(prisma, { userId: user.id, stagedId }))) {
    throw new Error("That revision was not found.");
  }
  revalidatePath("/");
});
