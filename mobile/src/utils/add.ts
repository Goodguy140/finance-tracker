import type { QuickAddPreview, TransactionType } from '@/api/types';
import { relativeDay } from '@/utils/dates';
import { formatCents } from '@/utils/money';
import { parseAmountInput, parseTagsInput } from '@/utils/transactions';

/** The server's longest title (`TRANSACTION_TITLE_MAX`). */
export const TITLE_MAX = 120;

/** The Add sheet as typed. A null category or account means "Automatic". */
export type AddForm = {
  type: TransactionType;
  amount: string;
  title: string;
  date: string;
  /** Null lets the user's rules and past titles choose, as the website's Add card does. */
  categoryId: string | null;
  /** Expense or income: null is Automatic. A transfer: the account the money left. */
  accountId: string | null;
  /** A transfer's other side, where the money went. */
  transferAccountId: string | null;
  tags: string;
  note: string;
};

export function emptyAddForm(today: string, type: TransactionType = 'expense'): AddForm {
  return { type, amount: '', title: '', date: today, categoryId: null, accountId: null, transferAccountId: null, tags: '', note: '' };
}

/**
 * Switching between expense, income and transfer keeps what was typed and the account, but not a
 * category of the other kind, nor a transfer's other side.
 */
export function switchAddType(form: AddForm, type: TransactionType): AddForm {
  if (type === form.type) return form;
  return { ...form, type, categoryId: null, transferAccountId: null };
}

/** The `POST /api/v1/transactions` body for the form, or what to fix first. */
export function addBody(form: AddForm): { body: Record<string, unknown> } | { error: string } {
  const cents = parseAmountInput(form.amount);
  if (cents === null) return { error: 'Enter an amount, like 12.50.' };
  if (cents < 0 && form.type === 'income') return { error: 'Income is always positive.' };
  if (cents < 0 && form.type === 'transfer') return { error: 'A transfer’s amount is always positive: it is what left the first account.' };
  const title = form.title.trim();
  const note = form.note.trim();
  const tags = parseTagsInput(form.tags);
  const common = {
    type: form.type,
    amountCents: cents,
    date: form.date,
    ...(title ? { title } : {}),
    ...(note ? { note } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  };
  if (form.type === 'transfer') {
    if (!form.accountId || !form.transferAccountId) return { error: 'Choose both accounts: where the money left and where it went.' };
    if (form.accountId === form.transferAccountId) return { error: 'Choose two different accounts.' };
    return { body: { ...common, accountId: form.accountId, transferAccountId: form.transferAccountId } };
  }
  return {
    body: {
      ...common,
      ...(form.categoryId ? { categoryId: form.categoryId } : {}),
      ...(form.accountId ? { accountId: form.accountId } : {}),
    },
  };
}

/**
 * Whether search text is worth asking the server to read as an add: it needs an amount and a
 * word ("12.50 coffee"). The server decides; this only spares it every plain search.
 */
export function mightBeQuickAdd(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length <= 200 && /\d/.test(trimmed) && /\p{L}/u.test(trimmed);
}

/** The two lines the search shows for an add: what, and how it would be filed. */
export function quickAddLines(preview: QuickAddPreview, currency: string, todayYmd: string): { title: string; detail: string } {
  const filed = preview.transfer
    ? [
        preview.transfer.toAccountName ? `Transfer to ${preview.transfer.toAccountName}` : 'Transfer',
        preview.accountName ? `from ${preview.accountName}` : null,
      ]
        .filter(Boolean)
        .join(' ')
    : [preview.split ?? preview.categoryName, preview.accountName].filter(Boolean).join(' · ');
  return {
    title: `${formatCents(preview.amountCents, currency)} ${preview.title}`,
    detail: `${relativeDay(preview.dateYmd, todayYmd)} · ${filed}`,
  };
}
