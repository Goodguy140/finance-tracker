import type { AlertTiming, Me } from '@/api/types';
import { amountInputText, parseAmountInput } from '@/utils/transactions';

/** When the alerts come, from Settings on the phone, as the website's Settings → Notifications sets it. */

export const ALERT_TIMING_PATH = '/api/v1/alert-timing';
export const DIGEST_PREVIEW_PATH = '/api/v1/alert-timing/digest-preview';

export type AlertTimingChange = Partial<
  Pick<AlertTiming, 'billReminderDays' | 'chargeThresholdCents' | 'chargeUnusual' | 'digest' | 'budgetAlertEmail'>
>;

export function canSetAlertTiming(me: Me | undefined): boolean {
  return me?.features?.includes('alert-timing') ?? false;
}

export type ReminderChoice = { days: number | null; label: string };

/** Off, then each lead time the server offers, shortened to fit a segment ("The day before" is "Day before"). */
export function reminderChoices(timing: Pick<AlertTiming, 'billReminderOptions'>): ReminderChoice[] {
  const label = (days: number) => (days === 1 ? 'Day before' : days === 7 ? 'A week' : `${days} days`);
  return [{ days: null, label: 'Off' }, ...timing.billReminderOptions.map((days) => ({ days, label: label(days) }))];
}

export const DIGEST_CHOICES: { value: AlertTiming['digest']; label: string; note: string }[] = [
  { value: 'off', label: 'Off', note: 'No digest. Send one now to see what it looks like.' },
  { value: 'weekly', label: 'Weekly', note: 'Monday morning, covering Monday to Sunday.' },
  { value: 'monthly', label: 'Monthly', note: 'The morning of the 1st, covering the month before.' },
];

/** One line on what the reminders do now. */
export function reminderNote(days: number | null): string {
  if (days === null) return 'No reminders before bills are due.';
  const when = days === 1 ? 'the day before' : days === 7 ? 'a week before' : `${days} days before`;
  return `A reminder ${when} each recurring bill or transfer is due, listing what is coming and from which account.`;
}

/** The large-charge field as it shows a saved amount: empty while that check is off. */
export function chargeAmountText(cents: number | null): string {
  return cents === null ? '' : amountInputText(cents);
}

/**
 * What leaving the large-charge field asks for: a new amount, `null` cents to turn the check off
 * (the field emptied), nothing when it still says what is saved, or why it can't be saved.
 */
export function chargeAmountChange(
  text: string,
  savedCents: number | null,
): { cents: number | null } | { error: string } | null {
  if (!text.trim()) return savedCents === null ? null : { cents: null };
  const cents = parseAmountInput(text);
  if (cents === null || cents < 0) return { error: 'Enter an amount above zero, such as 250, or leave it empty.' };
  return cents === savedCents ? null : { cents };
}
