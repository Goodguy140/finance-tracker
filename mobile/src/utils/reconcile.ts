import type { Reconcile } from '@/api/types';
import { parseBalanceInput } from '@/utils/balances';
import { formatCents } from '@/utils/money';

/** Reconcile with a statement, on servers that list `reconcile` in `/api/v1/me`. */
export function canReconcile(me: { features?: string[] } | undefined): boolean {
  return me?.features?.includes('reconcile') ?? false;
}

export type Statement = { from: string; to: string; opening: string; closing: string };

export function reconcilePath(accountId: string, statement?: { from: string; to: string; openingCents: number; closingCents: number }): string {
  const base = `/api/v1/accounts/${encodeURIComponent(accountId)}/reconcile`;
  if (!statement) return base;
  const params = new URLSearchParams({
    from: statement.from,
    to: statement.to,
    openingCents: String(statement.openingCents),
    closingCents: String(statement.closingCents),
  });
  return `${base}?${params.toString()}`;
}

/** The form's balance text from cents: 130000 → "1300.00", null → "". */
export function balanceText(cents: number | null): string {
  return cents === null ? '' : (cents / 100).toFixed(2);
}

/** The statement to check, or what is wrong with the form. */
export function checkedStatement(form: Statement): { from: string; to: string; openingCents: number; closingCents: number } | { error: string } {
  if (form.from > form.to) return { error: 'The statement has to end after it starts.' };
  const openingCents = parseBalanceInput(form.opening);
  const closingCents = parseBalanceInput(form.closing);
  if (openingCents === null || closingCents === null) return { error: 'Enter both balances from the statement, like 1234.56.' };
  return { from: form.from, to: form.to, openingCents, closingCents };
}

/** The balance fields' labels: a card or loan is entered as what is owed, as on the website. */
export function balanceLabels(liability: boolean): { opening: string; closing: string; running: string } {
  return liability
    ? { opening: 'Owed at the start', closing: 'Owed at the end', running: 'Owed' }
    : { opening: 'Opening balance', closing: 'Closing balance', running: 'Balance' };
}

/** "It matches…", or how far off and which way, with the hint and any bank rows still waiting. */
export function checkLines(check: NonNullable<Reconcile['check']>, currency: string): { matches: boolean; headline: string; hint: string | null } {
  if (check.differenceCents === 0) {
    return { matches: true, headline: 'It matches. Every entry for these dates agrees with the statement.', hint: null };
  }
  const waiting = check.waitingInQueue;
  return {
    matches: false,
    headline: `Off by ${formatCents(Math.abs(check.differenceCents), currency)}: the statement shows ${check.statementShows ?? 'more'} money in the account than the log does.`,
    hint: `Look for an entry that is missing, logged twice, on another account, or dated outside these days.${
      waiting > 0
        ? ` ${waiting} bank ${waiting === 1 ? 'transaction' : 'transactions'} for this account and these dates ${waiting === 1 ? 'is' : 'are'} still waiting in your review queue.`
        : ''
    }`,
  };
}

/** "+$1,000.00" or "−$200.00", from the account's side. */
export function inOutText(inCents: number, currency: string): string {
  return `${inCents >= 0 ? '+' : '−'}${formatCents(Math.abs(inCents), currency)}`;
}
