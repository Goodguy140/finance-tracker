import type { AccountBalance, AccountPage, NetWorthAccount } from '@/api/types';
import { formatDay } from '@/utils/dates';
import { formatCents } from '@/utils/money';

export const NET_WORTH_PATH = '/api/v1/net-worth';

export function accountPath(id: string, months: number): string {
  return `/api/v1/accounts/${encodeURIComponent(id)}?months=${months}`;
}

/** The register lengths the website offers. */
export const REGISTER_MONTHS = [3, 12] as const;

export type AccountGroup = { title: string; accounts: NetWorthAccount[] };

/**
 * What you have, what you owe, and accounts in another currency (listed, but left out of the
 * totals), in the order the server sends them: largest first, those with no balance last.
 */
export function groupAccounts(accounts: readonly NetWorthAccount[]): AccountGroup[] {
  const groups: AccountGroup[] = [
    { title: 'What you have', accounts: accounts.filter((a) => a.counted && !a.liability) },
    { title: 'What you owe', accounts: accounts.filter((a) => a.counted && a.liability) },
    { title: 'Other currencies', accounts: accounts.filter((a) => !a.counted) },
  ];
  return groups.filter((group) => group.accounts.length > 0);
}

const SOURCE: Record<AccountBalance['source'], string> = {
  bank: 'from your bank',
  manual: 'entered by you',
  portfolio: 'portfolio snapshot',
};

/** "Fri, Oct 31, from your bank". */
export function balanceSource(balance: AccountBalance): string {
  return `${formatDay(balance.date)}, ${SOURCE[balance.source]}`;
}

/** "+$12.00" or "−$12.00": money into the account, or out of it. */
export function signedCents(cents: number, currency: string): string {
  return cents >= 0 ? `+${formatCents(cents, currency)}` : `−${formatCents(-cents, currency)}`;
}

/** The website's line above the register. */
export function registerNote(page: Pick<AccountPage, 'balance' | 'liability'>): string {
  if (!page.balance) return 'Add a balance to see the running balance beside each entry.';
  return `Running ${page.liability ? 'amount owed' : 'balance'}, worked back from the ${formatDay(page.balance.date)} balance. Entries after it are marked with *: no balance has confirmed them yet.`;
}

/** "Limit $5,000.00, 40% used (over 30%). Payment due on the 15th of each month." */
export function cardTerms(card: NonNullable<AccountPage['card']>, currency: string): string {
  const parts: string[] = [];
  if (card.limitCents !== null) {
    let limit = `Limit ${formatCents(card.limitCents, currency)}`;
    if (card.utilization) limit += `, ${card.utilization.pct}% used${card.utilization.high ? ` (over ${card.highPct}%)` : ''}`;
    parts.push(`${limit}.`);
  }
  if (card.dueDay) parts.push(`Payment due on ${card.dueDay} of each month.`);
  return parts.join(' ');
}
