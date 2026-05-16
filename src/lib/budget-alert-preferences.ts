export const BUDGET_ALERT_PREFS_KEY = "finance-tracker:budget-alert-prefs";
export const BUDGET_ALERT_NOTIFIED_KEY = "finance-tracker:budget-alert-notified";
export const BUDGET_ALERT_DISMISSED_KEY = "finance-tracker:budget-alert-dismissed";

export type BudgetAlertPreferences = {
  browserEnabled: boolean;
  emailEnabled: boolean;
};

export const DEFAULT_BUDGET_ALERT_PREFS: BudgetAlertPreferences = {
  browserEnabled: false,
  emailEnabled: false,
};

export function readBudgetAlertPreferences(): BudgetAlertPreferences {
  if (typeof window === "undefined") return DEFAULT_BUDGET_ALERT_PREFS;
  try {
    const raw = localStorage.getItem(BUDGET_ALERT_PREFS_KEY);
    if (!raw) return DEFAULT_BUDGET_ALERT_PREFS;
    const parsed = JSON.parse(raw) as Partial<BudgetAlertPreferences>;
    return {
      browserEnabled: Boolean(parsed.browserEnabled),
      emailEnabled: Boolean(parsed.emailEnabled),
    };
  } catch {
    return DEFAULT_BUDGET_ALERT_PREFS;
  }
}

export function writeBudgetAlertPreferences(prefs: BudgetAlertPreferences): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(BUDGET_ALERT_PREFS_KEY, JSON.stringify(prefs));
}

/** Last notified severity per category (`warning` | `critical`) to avoid duplicate browser alerts. */
export type NotifiedMap = Record<string, BudgetWarningSeverityStored>;

export type BudgetWarningSeverityStored = "warning" | "critical";

export function readNotifiedMap(): NotifiedMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(BUDGET_ALERT_NOTIFIED_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as NotifiedMap;
  } catch {
    return {};
  }
}

export function writeNotifiedMap(map: NotifiedMap): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(BUDGET_ALERT_NOTIFIED_KEY, JSON.stringify(map));
}

export function shouldNotifyBrowser(
  categoryId: string,
  severity: BudgetWarningSeverityStored,
  notified: NotifiedMap,
): boolean {
  const prev = notified[categoryId];
  if (!prev) return true;
  if (severity === "critical" && prev === "warning") return true;
  return false;
}

export type BudgetWarningDismissalInput = {
  periodKey: string;
  categoryId: string;
  severity: BudgetWarningSeverityStored;
};

export type DismissedBudgetWarningMap = Record<string, true>;

export function budgetWarningDismissalKey({
  periodKey,
  categoryId,
  severity,
}: BudgetWarningDismissalInput): string {
  return `${periodKey}|${categoryId}|${severity}`;
}

export function readDismissedBudgetWarnings(): DismissedBudgetWarningMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(BUDGET_ALERT_DISMISSED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => value === true),
    ) as DismissedBudgetWarningMap;
  } catch {
    return {};
  }
}

export function writeDismissedBudgetWarnings(map: DismissedBudgetWarningMap): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(BUDGET_ALERT_DISMISSED_KEY, JSON.stringify(map));
}
