import { describe, expect, it } from "vitest";
import { dateFromYmd } from "@/lib/date-only";
import { moneyFormatter } from "@/lib/insights/util";
import {
  annualCostCents,
  cancelLinkHref,
  cancelledSubscriptionInsights,
  dueDecisionReminders,
  parseCancelFields,
  type DecisionRule,
} from "./subscription-cancel";

function rule(overrides: Partial<DecisionRule> = {}): DecisionRule {
  return {
    id: "r1",
    name: "StreamCo trial",
    amountCents: 1_699,
    cadence: "MONTHLY",
    enabled: true,
    decideBy: dateFromYmd("2026-10-28"),
    decideRemindedFor: null,
    cancelUrl: "https://example.test/cancel",
    ...overrides,
  };
}

describe("dueDecisionReminders", () => {
  it("reminds within the window, once per decide-by date", () => {
    expect(dueDecisionReminders([rule()], "2026-10-25", 3).map((r) => r.name)).toEqual(["StreamCo trial"]);
    expect(dueDecisionReminders([rule()], "2026-10-24", 3)).toEqual([]);
    expect(dueDecisionReminders([rule({ decideRemindedFor: dateFromYmd("2026-10-28") })], "2026-10-25", 3)).toEqual([]);
    // Moved to a new date: reminded again for it.
    expect(
      dueDecisionReminders([rule({ decideRemindedFor: dateFromYmd("2026-09-28") })], "2026-10-25", 3),
    ).toHaveLength(1);
  });

  it("skips a past date, a disabled rule and a rule without a date", () => {
    expect(dueDecisionReminders([rule()], "2026-10-29", 7)).toEqual([]);
    expect(dueDecisionReminders([rule({ enabled: false })], "2026-10-25", 7)).toEqual([]);
    expect(dueDecisionReminders([rule({ decideBy: null })], "2026-10-25", 7)).toEqual([]);
  });
});

describe("cancelledSubscriptionInsights", () => {
  const fmt = moneyFormatter("CAD");
  const now = new Date("2026-10-25T12:00:00Z");
  const base = { id: "r1", name: "Gym", amountCents: 5_000, cadence: "MONTHLY" as const };

  it("shows a recent cancellation with its yearly saving under Going well", () => {
    const [insight] = cancelledSubscriptionInsights([{ ...base, enabled: false, cancelledAt: new Date("2026-10-01T00:00:00Z") }], now, fmt);
    expect(insight).toMatchObject({ section: "good", key: "good:cancelled:r1", annualCents: 60_000 });
    expect(insight.title).toBe("Cancelled Gym: saving $600 a year");
  });

  it("leaves out old cancellations and rules turned back on", () => {
    expect(cancelledSubscriptionInsights([{ ...base, enabled: false, cancelledAt: new Date("2026-06-01T00:00:00Z") }], now, fmt)).toEqual([]);
    expect(cancelledSubscriptionInsights([{ ...base, enabled: true, cancelledAt: new Date("2026-10-01T00:00:00Z") }], now, fmt)).toEqual([]);
    expect(cancelledSubscriptionInsights([{ ...base, enabled: false, cancelledAt: null }], now, fmt)).toEqual([]);
  });
});

describe("helpers", () => {
  it("annualises by cadence", () => {
    expect(annualCostCents(1_000, "WEEKLY")).toBe(52_000);
    expect(annualCostCents(12_000, "YEARLY")).toBe(12_000);
    expect(annualCostCents(10_000, "BIENNIAL")).toBe(5_000);
  });

  it("links only web addresses", () => {
    expect(cancelLinkHref("https://x.test/c")).toBe("https://x.test/c");
    expect(cancelLinkHref("Call 1-800-555-0100")).toBeNull();
    expect(cancelLinkHref(null)).toBeNull();
  });

  it("parses the form fields and refuses a script link", () => {
    expect(parseCancelFields({ cancelUrl: " ", decideBy: "" })).toEqual({ cancelUrl: null, decideBy: null });
    expect(parseCancelFields({ cancelUrl: "Call them", decideBy: "2026-11-01" }).decideBy).toEqual(dateFromYmd("2026-11-01"));
    expect(() => parseCancelFields({ cancelUrl: "javascript:alert(1)", decideBy: "" })).toThrow(/http/);
  });
});
