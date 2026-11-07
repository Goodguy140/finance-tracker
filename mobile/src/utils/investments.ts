import type { InvestmentActivity, Investments, Me, ReturnRate, RoomYear } from '@/api/types';
import { formatCents } from '@/utils/money';
import { amountInputText, parseAmountInput } from '@/utils/transactions';

/** The website's Investments card on the phone: room left, value and return, and the activity. */

export const INVESTMENTS_PATH = '/api/v1/investments';

export function canTrackInvestments(me: Me | undefined): boolean {
  return me?.features?.includes('investments') ?? false;
}

/** Accounts that hold investments come first in the pickers; the rest follow, as the website offers them all. */
const INVESTMENT_TYPES = ['TFSA', 'RRSP', 'FHSA', 'NON_REGISTERED'];

export function isInvestmentAccountType(type: string): boolean {
  return INVESTMENT_TYPES.includes(type);
}

export function pickerAccounts(accounts: Investments['accounts']): Investments['accounts'] {
  const rank = (type: string) => (isInvestmentAccountType(type) ? 0 : 1);
  return [...accounts].sort((a, b) => rank(a.type) - rank(b.type));
}

/** "+5.2%", "-1.0% a year", or "—" when it can't be worked out, as Reports words a return. */
export function rateText(rate: ReturnRate): string {
  if (!rate) return '—';
  const pct = (rate.rate * 100).toFixed(1).replace(/^-0\.0$/, '0.0');
  return `${rate.rate > 0 ? '+' : ''}${pct}%${rate.annualized ? ' a year' : ''}`;
}

export function returnLine(row: { thisYear: ReturnRate; twelveMonths: ReturnRate }): string {
  return `${rateText(row.thisYear)} this year · ${rateText(row.twelveMonths)} over 12 months`;
}

/** "TFSA 2026", "RRSP 2025 limit": an RRSP's room year is its deduction limit's. */
export function roomLabel(room: Pick<RoomYear, 'accountType' | 'year'>): string {
  return `${room.accountType} ${room.year}${room.accountType === 'RRSP' ? ' limit' : ''}`;
}

export function roomValue(room: RoomYear, currency: string): string {
  if (room.remainingCents === null) return `No ${room.year} figure yet`;
  return room.overCents > 0
    ? `${formatCents(room.overCents, currency)} over`
    : `${formatCents(room.remainingCents, currency)} left`;
}

/** Where the figure came from, and what has gone in and out against it. */
export function roomNote(room: RoomYear, currency: string): string {
  const money = (cents: number) => formatCents(cents, currency);
  const source =
    room.source === 'entered'
      ? `${money(room.startingRoomCents ?? 0)} from CRA`
      : room.source === 'estimated'
        ? `About ${money(room.startingRoomCents ?? 0)}, estimated from your ${room.estimatedFromYear} figure`
        : room.accountType === 'RRSP'
          ? 'Enter the deduction limit from your notice of assessment'
          : 'Enter the figure from CRA My Account';
  const moved = [
    room.contributedCents ? `${money(room.contributedCents)} in` : '',
    room.withdrawnCents ? `${money(room.withdrawnCents)} out` : '',
  ].filter(Boolean);
  return [source, ...moved].join(' · ');
}

/** What the room prompt asks for, in the words CRA uses for it. */
export const ROOM_PROMPT: Record<RoomYear['accountType'], string> = {
  TFSA: 'Your TFSA contribution room on January 1, from CRA My Account. It already includes unused room and last year’s withdrawals.',
  RRSP: 'The RRSP deduction limit for the year, from your notice of assessment. Contributions in the first 60 days of the next year count against it.',
  FHSA: 'Your FHSA participation room for the year, from your notice of assessment. In the year you open your first FHSA, it is $8,000.',
};

/** A room figure as typed: signed, since a TFSA statement shows an excess as negative room. Zero is a figure too. */
export function parseRoomInput(raw: string): number | null {
  const cleaned = raw.trim();
  if (/^-?\$?0+(\.0{0,2})?$/.test(cleaned.replace(/[\s,]/g, ''))) return 0;
  return parseAmountInput(cleaned);
}

export const ACTIVITY_TITLE: Record<InvestmentActivity['kind'], string> = {
  contribution: 'Contribution',
  withdrawal: 'Withdrawal',
  value: 'Portfolio value',
  transfer: 'Transfer in',
};

export function activityAmount(item: InvestmentActivity): string {
  return `${item.kind === 'withdrawal' ? '−' : ''}${formatCents(item.amountCents, item.currency)}`;
}

export type EntryKind = 'flow' | 'value';

export type EntryForm = {
  accountId: string;
  direction: 'contribution' | 'withdrawal';
  amount: string;
  date: string;
  note: string;
};

export function entryForm(item: InvestmentActivity | undefined, data: Investments): EntryForm {
  if (item) {
    return {
      accountId: item.accountId ?? '',
      direction: item.kind === 'withdrawal' ? 'withdrawal' : 'contribution',
      amount: amountInputText(item.amountCents),
      date: item.date,
      note: item.note ?? '',
    };
  }
  return { accountId: pickerAccounts(data.accounts)[0]?.id ?? '', direction: 'contribution', amount: '', date: data.today, note: '' };
}

export function entryPath(kind: EntryKind, id?: string | null): string {
  return `${INVESTMENTS_PATH}/${kind === 'flow' ? 'contributions' : 'values'}${id ? `/${encodeURIComponent(id)}` : ''}`;
}

/** The body for a contribution or withdrawal (`flow`) or a portfolio value, or what is missing. */
export function entryBody(kind: EntryKind, form: EntryForm): { body: Record<string, unknown> } | { error: string } {
  if (!form.accountId) return { error: 'Pick an account.' };
  const zero = form.amount.trim() !== '' && /^\$?0+(\.0{0,2})?$/.test(form.amount.trim());
  const cents = kind === 'value' && zero ? 0 : parseAmountInput(form.amount);
  if (cents === null || cents < 0 || (kind === 'flow' && cents === 0)) {
    return { error: kind === 'flow' ? 'Enter the amount, like 500.' : 'Enter the account’s total value, like 25000.' };
  }
  const note = form.note.trim() || null;
  return kind === 'flow'
    ? { body: { accountId: form.accountId, direction: form.direction, amountCents: cents, date: form.date, note } }
    : { body: { accountId: form.accountId, totalValueCents: cents, date: form.date, note } };
}
