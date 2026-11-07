import type { AccountPage, Me } from '@/api/types';
import { amountInputText, parseAmountInput } from '@/utils/transactions';

/** Settings → Accounts on the phone: adding an account, and changing or archiving one from its page. */

export const ACCOUNTS_PATH = '/api/v1/accounts';

export function canEditAccounts(me: Me | undefined): boolean {
  return me?.features?.includes('account-settings') ?? false;
}

/** The website's types, in its order. */
export const ACCOUNT_TYPES: { value: string; label: string }[] = [
  { value: 'CHEQUING', label: 'Chequing' },
  { value: 'SAVINGS', label: 'Savings' },
  { value: 'CREDIT_CARD', label: 'Credit card' },
  { value: 'TFSA', label: 'TFSA' },
  { value: 'RRSP', label: 'RRSP' },
  { value: 'FHSA', label: 'FHSA' },
  { value: 'NON_REGISTERED', label: 'Non-registered' },
  { value: 'CASH', label: 'Cash' },
  { value: 'LOAN', label: 'Loan' },
  { value: 'MORTGAGE', label: 'Mortgage' },
  { value: 'PROPERTY', label: 'Property' },
];

export type AccountForm = {
  name: string;
  type: string;
  currency: string;
  countsAsSavings: boolean;
  /** A credit card's limit and due day; empty clears either. */
  creditLimit: string;
  dueDay: string;
};

export function emptyAccountForm(currency: string): AccountForm {
  return { name: '', type: 'CHEQUING', currency, countsAsSavings: false, creditLimit: '', dueDay: '' };
}

export function accountForm(page: AccountPage): AccountForm {
  const settings = page.settings;
  return {
    name: page.account.name,
    type: page.account.type,
    currency: page.account.currency,
    countsAsSavings: settings?.countsAsSavings ?? false,
    creditLimit: settings?.creditLimitCents ? amountInputText(settings.creditLimitCents) : '',
    dueDay: settings?.paymentDueDay ? String(settings.paymentDueDay) : '',
  };
}

function checkedName(form: AccountForm): string | { error: string } {
  const name = form.name.trim();
  return name.length < 2 || name.length > 80 ? { error: 'Name the account, in 2 to 80 characters.' } : name;
}

/** `POST /api/v1/accounts`: the server picks the currency and Counts as savings from the user and the type. */
export function newAccountBody(form: AccountForm): { body: { name: string; type: string } } | { error: string } {
  const name = checkedName(form);
  if (typeof name !== 'string') return name;
  return { body: { name, type: form.type } };
}

/** `PATCH /api/v1/accounts/:id` with only what changed, or what is wrong; null when nothing did. */
export function accountPatch(form: AccountForm, page: AccountPage): { body: Record<string, unknown> } | { error: string } | null {
  const name = checkedName(form);
  if (typeof name !== 'string') return name;
  const currency = form.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { error: 'A currency is a 3-letter code, like CAD.' };
  const body: Record<string, unknown> = {};
  if (name !== page.account.name) body.name = name;
  if (form.type !== page.account.type) body.type = form.type;
  if (currency !== page.account.currency) body.currency = currency;
  if (page.settings && form.countsAsSavings !== page.settings.countsAsSavings) body.countsAsSavings = form.countsAsSavings;
  if (form.type === 'CREDIT_CARD' && page.settings) {
    let limit: number | null = null;
    if (form.creditLimit.trim()) {
      limit = parseAmountInput(form.creditLimit);
      if (limit === null || limit <= 0) return { error: 'Enter the credit limit as an amount, like 5000.' };
    }
    let dueDay: number | null = null;
    if (form.dueDay.trim()) {
      dueDay = /^\d{1,2}$/.test(form.dueDay.trim()) ? Number(form.dueDay.trim()) : 0;
      if (dueDay < 1 || dueDay > 31) return { error: 'Enter the due day as a day of the month, 1 to 31.' };
    }
    if (limit !== page.settings.creditLimitCents) body.creditLimitCents = limit;
    if (dueDay !== page.settings.paymentDueDay) body.paymentDueDay = dueDay;
  }
  return Object.keys(body).length > 0 ? { body } : null;
}
