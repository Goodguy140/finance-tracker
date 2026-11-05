import type { AppBankLink, PrismaClient, User } from "@prisma/client";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { appleAppId } from "@/lib/apple-app-site";
import { formatDateOnlyUtc } from "@/lib/date-only";
import { PlaidApiError, type PlaidClient } from "@/lib/plaid/client";
import { completeUpdate, linkBank, type PlaidUpdateKind } from "@/lib/plaid/connections";
import { openAccessToken } from "@/lib/plaid/service";
import { resolvePlaidWebhookUrl } from "@/lib/plaid/webhook-url";
import { describeHistoryWindow, isHistoryWindowDays, resolveHistoryCutoff } from "@/lib/plaid/window";
import { verifyAuthentication } from "@/lib/webauthn";
import { getWebAuthnRp } from "@/lib/webauthn-rp";

/**
 * Connecting a bank, or fixing a connection, from the phone app with Plaid Link's iOS SDK.
 *
 * The website asks "Confirm it's you" before Plaid Link opens and again before the connection is
 * stored (`requireFreshMfa` in `actions/plaid.ts`): a bank connection is a standing credential to
 * someone's account, so a stolen session alone must not be able to make one. The app has no web
 * session to step up, so it confirms with Face ID instead: a fresh passkey assertion for the
 * signed-in user (`POST /api/v1/app/step-up/options`, then sent with `POST /api/v1/banks/link`).
 * That starts an `AppBankLink`, which allows finishing that one Link session, once, from that
 * phone, within `APP_BANK_LINK_TTL_MS`: Link runs for minutes (a bank's own sign-in can be part of
 * it), and a second Face ID at the end would only ask the same question again.
 *
 * Everything Plaid bills for goes through `linkBank` and `completeUpdate`, as on the website, so
 * the same refusals apply: no second connection to a bank already connected, nothing left
 * billing at Plaid when a link is declined.
 */

export const APP_BANK_LINK_TTL_MS = 30 * 60 * 1000;

/**
 * Where Plaid sends someone back to the app after signing in on their bank's own site or app
 * (OAuth). iOS needs an https address that opens the app: the app's associated domains include
 * this server (`applinks:`, `mobile/app.config.ts`), this server's app-site association names
 * the path (`src/lib/apple-app-site.ts`), and the Plaid dashboard lists the address under
 * Allowed redirect URIs. Only the app's home server has all three, so only it sends one.
 */
export const PLAID_OAUTH_PATH = "/plaid/oauth";

export function plaidOAuthRedirectUri(appId: string | null = appleAppId()): string | null {
  if (!appId) return null;
  try {
    return `${getWebAuthnRp().origin}${PLAID_OAUTH_PATH}`;
  } catch {
    return null;
  }
}

export type StepUp = { challengeId: string; response: AuthenticationResponseJSON };

export type BankLinkRequest =
  | { stepUp: StepUp; mode: "create"; historyDays: number }
  | { stepUp: StepUp; mode: "update"; plaidItemId: string; updateKind: PlaidUpdateKind };

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function readStepUp(raw: unknown): StepUp | null {
  if (!raw || typeof raw !== "object") return null;
  const { challengeId, response } = raw as Record<string, unknown>;
  if (typeof challengeId !== "string" || !challengeId || !response || typeof response !== "object") return null;
  return { challengeId, response: response as AuthenticationResponseJSON };
}

/** `POST /api/v1/banks/link`'s body. */
export function parseBankLinkRequest(body: unknown): Parsed<BankLinkRequest> {
  const fields = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const stepUp = readStepUp(fields.stepUp);
  if (!stepUp) return { ok: false, error: "Confirm it's you with Face ID first." };
  if (fields.mode === "create") {
    const days = typeof fields.historyDays === "number" ? fields.historyDays : 90;
    if (!isHistoryWindowDays(days)) return { ok: false, error: "Choose how much history to fetch." };
    return { ok: true, value: { stepUp, mode: "create", historyDays: days } };
  }
  if (fields.mode === "update") {
    if (typeof fields.plaidItemId !== "string" || !fields.plaidItemId) return { ok: false, error: "Choose a bank." };
    const updateKind: PlaidUpdateKind = fields.updateKind === "accounts" ? "accounts" : "reauth";
    return { ok: true, value: { stepUp, mode: "update", plaidItemId: fields.plaidItemId, updateKind } };
  }
  return { ok: false, error: "Say whether to connect a new bank or fix one." };
}

export type Failure = { ok: false; status: 400 | 401 | 404 | 409 | 410 | 502; error: string };

/** Plaid's own message is written for a person; anything else stays generic. */
function plaidFailure(err: unknown): Failure {
  if (err instanceof PlaidApiError) {
    return { ok: false, status: 502, error: err.message || `Plaid rejected the request (${err.errorCode}).` };
  }
  throw err;
}

type Deps = {
  db: PrismaClient;
  plaid: () => Promise<PlaidClient>;
  /** The passkey check; resolves when the assertion is the signed-in user's, fresh and verified. */
  verifyStepUp?: (userId: string, stepUp: StepUp) => Promise<boolean>;
  now?: Date;
};

async function defaultVerifyStepUp(userId: string, stepUp: StepUp): Promise<boolean> {
  try {
    await verifyAuthentication({ ...stepUp, purpose: "authenticate", expectedUserId: userId });
    return true;
  } catch {
    return false;
  }
}

export type StartedBankLink = {
  ok: true;
  link: AppBankLink;
  linkToken: string;
  /** For a new bank: how far back Plaid will fetch, as the website says it. */
  cutoffNote: string | null;
  institutionName: string | null;
};

/**
 * Checks Face ID, then mints the Link token for a new bank or for fixing one the user holds,
 * and records the `AppBankLink` that lets this phone finish it.
 */
export async function startAppBankLink(
  deps: Deps,
  input: { user: Pick<User, "id" | "countryCode" | "timezone">; appDeviceId: string; request: BankLinkRequest },
): Promise<StartedBankLink | Failure> {
  const { db } = deps;
  const now = deps.now ?? new Date();
  const { user, request } = input;

  const confirmed = await (deps.verifyStepUp ?? defaultVerifyStepUp)(user.id, request.stepUp);
  if (!confirmed) return { ok: false, status: 401, error: "Face ID did not confirm it was you. Try again." };

  const item =
    request.mode === "update"
      ? await db.plaidItem.findFirst({ where: { id: request.plaidItemId, userId: user.id } })
      : null;
  if (request.mode === "update" && !item) return { ok: false, status: 404, error: "That bank connection was not found." };

  const common = {
    clientUserId: user.id,
    clientName: "Finance Tracker",
    countryCodes: [user.countryCode || "CA"],
    webhook: resolvePlaidWebhookUrl() ?? undefined,
    redirectUri: plaidOAuthRedirectUri() ?? undefined,
  };
  let linkToken: string;
  try {
    const client = await deps.plaid();
    const token =
      request.mode === "update"
        ? await client.createLinkToken({
            ...common,
            accessToken: openAccessToken(item!),
            accountSelection: request.updateKind === "accounts",
          })
        : await client.createLinkToken({ ...common, daysRequested: request.historyDays });
    linkToken = token.link_token;
  } catch (err) {
    return plaidFailure(err);
  }

  await db.appBankLink.deleteMany({ where: { userId: user.id, expiresAt: { lte: now } } });
  const link = await db.appBankLink.create({
    data: {
      userId: user.id,
      appDeviceId: input.appDeviceId,
      mode: request.mode,
      plaidItemId: item?.id ?? null,
      updateKind: request.mode === "update" ? request.updateKind : null,
      historyDays: request.mode === "create" ? request.historyDays : null,
      expiresAt: new Date(now.getTime() + APP_BANK_LINK_TTL_MS),
    },
  });

  const cutoffNote =
    request.mode === "create"
      ? describeHistoryWindow(request.historyDays, resolveHistoryCutoff(request.historyDays, user.timezone, now))
      : null;
  return { ok: true, link, linkToken, cutoffNote, institutionName: item?.institutionName ?? null };
}

export type FinishedBankLink =
  | {
      ok: true;
      kind: "linked";
      link: AppBankLink;
      plaidItemId: string;
      institutionName: string;
      accountCount: number;
      /** "reauth" when Link reconnected a bank this user already had. */
      mode: "create" | "reauth";
      cutoffDisplay: string;
    }
  | { ok: true; kind: "updated"; link: AppBankLink; plaidItemId: string; institutionName: string; newAccounts: number };

/**
 * Finishes what `startAppBankLink` began: stores a new bank from Link's public token, or, for a
 * fix, re-reads the connection (an update-mode public token is not exchanged; the access token is
 * unchanged). The `AppBankLink` is used up first, so a second call finishes nothing.
 */
export async function finishAppBankLink(
  deps: Deps,
  input: {
    user: Pick<User, "id" | "countryCode" | "timezone">;
    appDeviceId: string;
    linkId: string;
    publicToken?: string;
  },
): Promise<FinishedBankLink | Failure> {
  const { db } = deps;
  const now = deps.now ?? new Date();
  const { user } = input;

  const link = await db.appBankLink.findFirst({
    where: { id: input.linkId, userId: user.id, appDeviceId: input.appDeviceId },
  });
  const used = link
    ? await db.appBankLink.deleteMany({ where: { id: link.id, expiresAt: { gt: now } } })
    : { count: 0 };
  if (!link || used.count !== 1) {
    return { ok: false, status: 410, error: "This bank connection took too long or was already finished. Start again." };
  }

  try {
    if (link.mode === "update") {
      const item = link.plaidItemId
        ? await db.plaidItem.findFirst({ where: { id: link.plaidItemId, userId: user.id } })
        : null;
      if (!item) return { ok: false, status: 404, error: "That bank connection was not found." };
      const updateKind: PlaidUpdateKind = link.updateKind === "accounts" ? "accounts" : "reauth";
      const { newAccounts } = await completeUpdate({ prisma: db, client: await deps.plaid() }, item, updateKind);
      return {
        ok: true,
        kind: "updated",
        link,
        plaidItemId: item.id,
        institutionName: item.institutionName ?? "Your bank",
        newAccounts,
      };
    }

    if (!input.publicToken) return { ok: false, status: 400, error: "Plaid did not return a token. Try connecting again." };
    const days = link.historyDays && isHistoryWindowDays(link.historyDays) ? link.historyDays : 90;
    const outcome = await linkBank(
      { prisma: db, client: await deps.plaid() },
      { user, publicToken: input.publicToken, days, now },
    );
    if (outcome.kind === "refused") {
      return {
        ok: false,
        status: 409,
        error:
          outcome.reason === "linked-elsewhere"
            ? "That bank connection is already linked to another account here."
            : `${outcome.institutionName ?? "That bank"} is already connected. Pull down on Review to check it for new transactions, or use Sign In Again if it needs it. Connecting it twice would bill you for two connections.`,
      };
    }
    return {
      ok: true,
      kind: "linked",
      link,
      plaidItemId: outcome.plaidItemId,
      institutionName: outcome.institutionName ?? "Your bank",
      accountCount: outcome.accountCount,
      mode: outcome.mode,
      cutoffDisplay: formatDateOnlyUtc(outcome.historyCutoff),
    };
  } catch (err) {
    return plaidFailure(err);
  }
}
