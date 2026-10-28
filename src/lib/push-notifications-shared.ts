/** The alerts a phone can opt in to; client-safe (no server imports). */
export const PUSH_ALERT_KINDS = ["billReminders", "chargeAlerts", "budgetAlerts"] as const;
export type PushAlertKind = (typeof PUSH_ALERT_KINDS)[number];

export const PUSH_ALERT_LABELS: Record<PushAlertKind, string> = {
  billReminders: "Bill reminders",
  chargeAlerts: "Large and unusual charges",
  budgetAlerts: "Budget alerts",
};
