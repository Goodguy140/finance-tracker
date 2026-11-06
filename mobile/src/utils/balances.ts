import type { AccountPage } from '@/api/types';

/** Where the phone records a balance it was typed, and deletes one again. */
export function balancesPath(accountId: string, balanceId?: string): string {
  const base = `/api/v1/accounts/${encodeURIComponent(accountId)}/balances`;
  return balanceId ? `${base}/${encodeURIComponent(balanceId)}` : base;
}

/**
 * Whether this account's balance can be typed in from the phone: an open account, on a server new
 * enough to take it (one from before sends no `manualBalances`).
 */
export function canRecordBalance(page: Pick<AccountPage, 'account' | 'manualBalances'>): boolean {
  return page.manualBalances !== undefined && !page.account.archived;
}

/** "1,234.50", "$-20", "0" → cents. Unlike an entry's amount, a balance can be nothing at all. */
export function parseBalanceInput(raw: string): number | null {
  const cleaned = raw.replace(/[\s,$]/g, '');
  if (!/^-?\d+(\.\d{0,2})?$|^-?\.\d{1,2}$/.test(cleaned)) return null;
  const cents = Math.round(Number(cleaned) * 100);
  return Number.isFinite(cents) ? cents + 0 : null;
}

/** The website's wording for the field: a card or loan is entered as what is owed. */
export function balanceField(liability: boolean, currency: string): { label: string; hint: string } {
  return liability
    ? { label: `Amount owed (${currency})`, hint: 'What you still owe, as a positive number.' }
    : { label: `Balance (${currency})`, hint: 'Negative if the account is overdrawn.' };
}

/** The body to send, or what is wrong with the form. */
export function balanceBody(amount: string, date: string, todayYmd: string): { body: { balanceCents: number; date: string } } | { error: string } {
  const cents = parseBalanceInput(amount);
  if (cents === null) return { error: 'Type the balance as a number, like 1234.56.' };
  if (date > todayYmd) return { error: "A balance can't be dated after today." };
  return { body: { balanceCents: cents, date } };
}
