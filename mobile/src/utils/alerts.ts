import type { AlertKind } from '@/api/types';

/**
 * Alerts on the phone: bill reminders, large or unusual charges and budget alerts, sent by the
 * server through Apple push once the phone registers (`PUT /api/v1/app/device/push`).
 */

export const ALERT_KINDS: readonly AlertKind[] = ['billReminders', 'chargeAlerts', 'budgetAlerts'];

export const ALERT_LABELS: Record<AlertKind, string> = {
  billReminders: 'Bill reminders',
  chargeAlerts: 'Large and unusual charges',
  budgetAlerts: 'Budget alerts',
};

export const ALERTS_PATH = '/api/v1/app/device/push';

/** The screen a tapped alert opens: what is due on Home, the new charge in Transactions, Budgets. */
export function routeForAlert(data: unknown): '/' | '/transactions' | '/budgets' | null {
  const kind = typeof data === 'object' && data !== null ? (data as { kind?: unknown }).kind : undefined;
  switch (kind) {
    case 'billReminders':
    case 'test':
      return '/';
    case 'chargeAlerts':
      return '/transactions';
    case 'budgetAlerts':
      return '/budgets';
    default:
      return null;
  }
}

/**
 * Which Apple push service the token belongs to. TestFlight and App Store builds use production;
 * a development build run from Xcode or the dev client uses the sandbox.
 */
export function apnsEnvironment(isDevBuild: boolean): 'production' | 'development' {
  return isDevBuild ? 'development' : 'production';
}

/** The body that registers this phone, with whatever switch is changing. */
export function registrationBody(
  token: string,
  environment: 'production' | 'development',
  change: { alerts?: Partial<Record<AlertKind, boolean>>; hideAmounts?: boolean } = {},
) {
  return { token, environment, ...change };
}
