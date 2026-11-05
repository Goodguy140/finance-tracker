/*
 * The Banks screen: connecting a bank with Plaid Link, fixing one that needs it, and choosing
 * which account each bank account's transactions go to (`GET /api/v1/banks` and the routes
 * beside it, `src/lib/api-v1/banks.ts` and `src/lib/app-bank-link.ts` in the web app). Pure
 * functions only; `src/session/bank-link.ts` runs Face ID, Link and the network.
 */

export const BANKS_PATH = '/api/v1/banks';

export type UpdateKind = 'reauth' | 'accounts';

export type BankAccountRow = {
  id: string;
  name: string;
  mask: string | null;
  currency: string | null;
  /** The app account its transactions go to; null until chosen, and nothing syncs until then. */
  accountId: string | null;
};

export type LinkedBankDetail = {
  id: string;
  name: string;
  lastSyncedAt: string | null;
  historyCutoff: string;
  attention: { kind: string; message: string; actionLabel: string; updateKind: UpdateKind } | null;
  accounts: BankAccountRow[];
};

export type AppAccountChoice = { id: string; name: string; currency: string };

export type BanksScreenData = {
  /** Whether the server has Plaid set up at all. */
  available: boolean;
  /** Whether the server names this app in its app-site association (`APPLE_APP_ID`). */
  appLinking: boolean;
  /** Whether the signed-in person has a passkey for Face ID to confirm with. */
  hasPasskey: boolean;
  historyWindows: { days: number; label: string }[];
  defaultHistoryDays: number;
  accounts: AppAccountChoice[];
  banks: LinkedBankDetail[];
};

export type InAppLinking = { ok: true } | { ok: false; reason: string };

/**
 * Whether this phone can connect or fix a bank itself, and if not, why. It needs everything the
 * website's "Confirm it's you" and a bank's own sign-in rely on: Face ID with a passkey for this
 * server, which iOS allows only for the server the app was built for once that server names the
 * app, and the same pairing to bring someone back from their bank's app to Plaid.
 */
export function linkingInApp(input: {
  /** The passkey module is in this build (`passkeysAvailable`). */
  nativeReady: boolean;
  /** Signed in to the server this build was made for (`isHomeServer`). */
  homeServer: boolean;
  data: Pick<BanksScreenData, 'available' | 'appLinking' | 'hasPasskey'>;
}): InAppLinking {
  const { nativeReady, homeServer, data } = input;
  if (!data.available) {
    return { ok: false, reason: 'Bank connections are not set up on this server yet. An admin can add Plaid keys on the website.' };
  }
  if (!nativeReady) {
    return { ok: false, reason: "This version of the app can't connect banks. Update it from TestFlight, or use the website." };
  }
  if (!homeServer) {
    return { ok: false, reason: "This isn't the server this app was built for, so connecting or fixing a bank happens on the website." };
  }
  if (!data.appLinking) {
    return {
      ok: false,
      reason: "Your server isn't set up for this app's Face ID yet, so connecting or fixing a bank happens on the website. An admin turns it on with APPLE_APP_ID.",
    };
  }
  if (!data.hasPasskey) {
    return {
      ok: false,
      reason: "Add a passkey on the website first (Settings → Security). Face ID then confirms it's you before a bank is connected here.",
    };
  }
  return { ok: true };
}

export function bankAccountLabel(account: Pick<BankAccountRow, 'name' | 'mask'>): string {
  return account.mask ? `${account.name} ••${account.mask}` : account.name;
}

/**
 * The accounts a bank account can fill, as the website allows: the same currency, since amounts
 * are never converted, or any when the bank did not say which currency it is.
 */
export function accountChoices(bankAccount: Pick<BankAccountRow, 'currency'>, accounts: AppAccountChoice[]): AppAccountChoice[] {
  const currency = bankAccount.currency?.trim().toUpperCase();
  if (!currency) return accounts;
  return accounts.filter((a) => a.currency.trim().toUpperCase() === currency);
}

export function unmatchedCount(bank: Pick<LinkedBankDetail, 'accounts'>): number {
  return bank.accounts.filter((a) => a.accountId === null).length;
}

export type LinkStart = { linkId: string; linkToken: string; cutoffNote: string | null };

/** `POST /api/v1/banks/link`'s answer. */
export function readLinkStart(body: unknown): LinkStart | null {
  if (!body || typeof body !== 'object') return null;
  const { linkId, linkToken, cutoffNote } = body as Record<string, unknown>;
  if (typeof linkId !== 'string' || !linkId || typeof linkToken !== 'string' || !linkToken) return null;
  return { linkId, linkToken, cutoffNote: typeof cutoffNote === 'string' ? cutoffNote : null };
}

export type LinkFinish =
  | { kind: 'linked'; plaidItemId: string; institutionName: string; accountCount: number; cutoffDisplay: string }
  | { kind: 'updated'; plaidItemId: string; institutionName: string; newAccounts: number };

/** `POST /api/v1/banks/link/:id/complete`'s answer. */
export function readLinkFinish(body: unknown): LinkFinish | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.plaidItemId !== 'string' || typeof b.institutionName !== 'string') return null;
  if (b.kind === 'linked' && typeof b.accountCount === 'number' && typeof b.cutoffDisplay === 'string') {
    return { kind: 'linked', plaidItemId: b.plaidItemId, institutionName: b.institutionName, accountCount: b.accountCount, cutoffDisplay: b.cutoffDisplay };
  }
  if (b.kind === 'updated' && typeof b.newAccounts === 'number') {
    return { kind: 'updated', plaidItemId: b.plaidItemId, institutionName: b.institutionName, newAccounts: b.newAccounts };
  }
  return null;
}

function accounts(n: number): string {
  return n === 1 ? '1 account' : `${n} accounts`;
}

/** What the screen says once Link is done. */
export function describeLinkFinish(result: LinkFinish): string {
  if (result.kind === 'linked') {
    return `${result.institutionName} is connected with ${accounts(result.accountCount)}. Choose where each account's transactions go below: nothing syncs from an account until you do.`;
  }
  if (result.newAccounts > 0) {
    return `${result.institutionName} now shares ${result.newAccounts === 1 ? '1 more account' : `${result.newAccounts} more accounts`}. Choose where its transactions go below.`;
  }
  return `${result.institutionName} is working again.`;
}
