import { describe, expect, it } from "vitest";
import {
  budgetWarningDismissalKey,
  shouldNotifyBrowser,
} from "./budget-alert-preferences";

describe("budget alert preference helpers", () => {
  it("scopes dismissal keys by period, category, and severity", () => {
    const warningKey = budgetWarningDismissalKey({
      periodKey: "2025-05",
      categoryId: "dining",
      severity: "warning",
    });

    expect(warningKey).toBe("2025-05|dining|warning");
    expect(
      budgetWarningDismissalKey({
        periodKey: "2025-05",
        categoryId: "dining",
        severity: "critical",
      }),
    ).not.toBe(warningKey);
    expect(
      budgetWarningDismissalKey({
        periodKey: "2025-06",
        categoryId: "dining",
        severity: "warning",
      }),
    ).not.toBe(warningKey);
  });

  it("renotifies only when a warning escalates to critical", () => {
    expect(shouldNotifyBrowser("dining", "warning", {})).toBe(true);
    expect(shouldNotifyBrowser("dining", "warning", { dining: "warning" })).toBe(false);
    expect(shouldNotifyBrowser("dining", "critical", { dining: "warning" })).toBe(true);
    expect(shouldNotifyBrowser("dining", "critical", { dining: "critical" })).toBe(false);
  });
});
