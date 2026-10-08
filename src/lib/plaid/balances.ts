import type { SyncAccountState } from "@/lib/plaid/sync-plan";
import type { PlaidApiAccount } from "@/lib/plaid/types";

/**
 * Balances for net worth, from the account list Plaid returns with /transactions/sync.
 *
 * Those are Plaid's cached balances and come free with the sync. The live /accounts/balance/get
 * is billed per call and is never used: a balance as fresh as the last sync is plenty for a
 * net-worth line drawn by month.
 *
 * Only accounts the user mapped and left syncing are recorded. `current` is used rather than
 * `available`: for a card or loan it is what is owed, which is how a liability is stored, and
 * for a deposit account it does not dip for pending holds. A null `current` (Plaid could not
 * resolve it) records nothing rather than a zero.
 */
export type BalanceReading = { accountId: string; balanceCents: number };

export function balanceReadings(
  accounts: readonly PlaidApiAccount[],
  mapped: ReadonlyMap<string, Pick<SyncAccountState, "accountId" | "syncEnabled">>,
): BalanceReading[] {
  const out: BalanceReading[] = [];
  for (const account of accounts) {
    const state = mapped.get(account.account_id);
    const current = account.balances?.current;
    if (!state?.accountId || !state.syncEnabled) continue;
    if (typeof current !== "number" || !Number.isFinite(current)) continue;
    out.push({ accountId: state.accountId, balanceCents: Math.round(current * 100) });
  }
  return out;
}
