import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Amounts are stored as bare cents in their account's currency (see home-currency.ts), so an
 * account's currency is what gives every amount on it a meaning. Two edits would quietly
 * change that meaning for history already recorded:
 *
 * - changing the currency of an account that already holds amounts, which re-labels them all;
 * - deleting a non-home-currency account, which detaches its transactions, and a transaction
 *   with no account counts as home currency, so its foreign cents land in the home totals.
 *
 * Both are refused until transactions carry their own currency. Archiving keeps the account
 * (and so the currency) while hiding it, which is what these edits are usually after.
 */

export type AccountUsage = {
  transactions: number;
  recurringRules: number;
  balanceSnapshots: number;
  plaidMapped: boolean;
};

type Db = PrismaClient | Prisma.TransactionClient;

export async function loadAccountUsage(db: Db, userId: string, accountId: string): Promise<AccountUsage> {
  const [transactions, recurringRules, balanceSnapshots, plaidAccounts] = await Promise.all([
    db.transaction.count({ where: { userId, OR: [{ accountId }, { transferAccountId: accountId }] } }),
    db.recurringTransaction.count({ where: { userId, OR: [{ accountId }, { transferAccountId: accountId }] } }),
    db.accountBalanceSnapshot.count({ where: { accountId } }),
    db.plaidAccount.count({ where: { userId, accountId } }),
  ]);
  return { transactions, recurringRules, balanceSnapshots, plaidMapped: plaidAccounts > 0 };
}

function plural(n: number, one: string): string {
  return `${n} ${one}${n === 1 ? "" : "s"}`;
}

/** Why the currency can't change, or null when it can (unchanged, or nothing recorded yet). */
export function currencyChangeRefusal(
  account: { name: string; currency: string },
  nextCurrency: string,
  usage: AccountUsage,
): string | null {
  if (account.currency.toUpperCase() === nextCurrency.toUpperCase()) return null;
  const held = [
    usage.transactions > 0 ? plural(usage.transactions, "transaction") : null,
    usage.recurringRules > 0 ? plural(usage.recurringRules, "recurring rule") : null,
    usage.balanceSnapshots > 0 ? plural(usage.balanceSnapshots, "balance") : null,
    usage.plaidMapped ? "a linked bank account" : null,
  ].filter((part): part is string => part !== null);
  if (held.length === 0) return null;
  return (
    `“${account.name}” already has ${held.join(", ")} in ${account.currency}. ` +
    `Changing its currency would relabel those amounts as ${nextCurrency.toUpperCase()} without converting them. ` +
    `Add a new ${nextCurrency.toUpperCase()} account instead, and archive this one when you're done with it.`
  );
}

/** Why the account can't be deleted on currency grounds, or null when it can. */
export function foreignAccountDeleteRefusal(
  account: { name: string; currency: string },
  homeCurrency: string,
  transactionCount: number,
): string | null {
  if (account.currency.toUpperCase() === homeCurrency.toUpperCase() || transactionCount === 0) return null;
  return (
    `“${account.name}” is a ${account.currency} account with ${plural(transactionCount, "transaction")}. ` +
    `Deleting it would leave them with no account, and they would then count as ${homeCurrency} in your totals. ` +
    `Archive it instead to hide it and keep its history as it is.`
  );
}
