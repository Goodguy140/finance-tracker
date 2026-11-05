import type { PrismaClient } from "@prisma/client";
import { appleAppId } from "@/lib/apple-app-site";
import { describePlaidItemAttention } from "@/lib/plaid/attention";
import { getPlaidConfig } from "@/lib/plaid/config";
import { setPlaidAccountMapping } from "@/lib/plaid/connections";
import { checkMappingAllowed } from "@/lib/plaid/mapping";
import { HISTORY_WINDOWS } from "@/lib/plaid/window";

/**
 * The phone app's Banks screen (`GET /api/v1/banks`): each connection with what it needs, if
 * anything, and its accounts with the app account each one fills, as Settings → Banks shows
 * them on the website. Plus what the screen needs to offer: whether Plaid is set up here, whether
 * the app can connect banks itself (`appLinking`: this server names the app in its association
 * file, which Face ID and the bank's sign-in return both need; `hasPasskey`: there is a passkey
 * to confirm with), the history windows a new connection can ask for, and the accounts a bank
 * account can fill.
 */
export async function banksForApp(db: PrismaClient, userId: string, plaidConfigured?: boolean) {
  const [items, accounts, passkeys] = await Promise.all([
    db.plaidItem.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      include: { plaidAccounts: { orderBy: { name: "asc" } } },
    }),
    db.account.findMany({
      where: { userId, archived: false },
      orderBy: { name: "asc" },
      select: { id: true, name: true, currency: true },
    }),
    db.webAuthnCredential.count({ where: { userId } }),
  ]);
  return {
    available: plaidConfigured ?? (await getPlaidConfig()) !== null,
    appLinking: appleAppId() !== null,
    hasPasskey: passkeys > 0,
    historyWindows: HISTORY_WINDOWS.map((w) => ({ days: w.days, label: w.label })),
    defaultHistoryDays: 90,
    accounts,
    banks: items.map((item) => {
      const attention = describePlaidItemAttention(item);
      return {
        id: item.id,
        name: item.institutionName ?? "Your bank",
        lastSyncedAt: item.lastSyncedAt?.toISOString() ?? null,
        historyCutoff: item.historyCutoff.toISOString().slice(0, 10),
        attention: attention
          ? { kind: attention.kind, message: attention.message, actionLabel: attention.actionLabel, updateKind: attention.action }
          : null,
        accounts: item.plaidAccounts.map((a) => ({
          id: a.id,
          name: a.name,
          mask: a.mask,
          currency: a.currency,
          accountId: a.accountId,
        })),
      };
    }),
  };
}

type Mapped =
  | { ok: true; plaidAccount: { id: string; name: string }; account: { id: string; name: string } | null }
  | { ok: false; status: 400 | 404; error: string };

/**
 * Points one bank account at an app account, or at none (`accountId` null), with the website's
 * rules (`mapPlaidAccountAction`): the user's own accounts, not archived, same currency.
 */
export async function mapBankAccountForApp(
  db: PrismaClient,
  userId: string,
  plaidAccountRowId: string,
  body: unknown,
): Promise<Mapped> {
  const raw = body && typeof body === "object" ? (body as Record<string, unknown>).accountId : undefined;
  if (raw !== null && typeof raw !== "string") return { ok: false, status: 400, error: "Send accountId, or null for none." };

  const plaidAccount = await db.plaidAccount.findFirst({ where: { id: plaidAccountRowId, userId } });
  if (!plaidAccount) return { ok: false, status: 404, error: "That bank account was not found." };

  if (raw === null || raw === "") {
    await setPlaidAccountMapping(db, plaidAccount, null);
    return { ok: true, plaidAccount, account: null };
  }

  const account = await db.account.findFirst({ where: { id: raw, userId } });
  if (!account) return { ok: false, status: 404, error: "That account was not found." };
  const allowed = checkMappingAllowed(
    { id: plaidAccount.id, name: plaidAccount.name, mask: plaidAccount.mask, currency: plaidAccount.currency },
    { id: account.id, name: account.name, currency: account.currency, archived: account.archived },
  );
  if (!allowed.ok) return { ok: false, status: 400, error: allowed.reason };

  await setPlaidAccountMapping(db, plaidAccount, account.id);
  return { ok: true, plaidAccount, account };
}
