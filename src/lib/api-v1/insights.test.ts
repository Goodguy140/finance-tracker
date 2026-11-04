import { describe, expect, it } from "vitest";
import type { InsightItemView } from "@/components/insights/insight-item";
import type { FinancialScore } from "@/lib/financial-score";
import { parseDismissBody, parseRestoreBody, serializeAppInsight, serializeAppScore } from "./insights";

function view(overrides: Partial<InsightItemView> = {}): InsightItemView {
  return {
    key: "price-rise:netflix",
    section: "saving",
    severity: "medium",
    title: "Netflix went up",
    body: "It was $16.49 and is now $20.99.",
    monthlyCents: 2_099,
    evidenceTxIds: ["t1"],
    evidence: [{ id: "t1", date: "2026-10-12", title: "", amountCents: 2_099, type: "EXPENSE" }],
    ...overrides,
  };
}

describe("serializeAppInsight", () => {
  it("names the website page for a link, and for a form the phone does not have", () => {
    expect(serializeAppInsight(view({ action: { kind: "link", href: "/settings/categories", label: "Set a budget" } })).website).toEqual({
      path: "/settings/categories",
      label: "Set a budget",
    });
    const track = serializeAppInsight(
      view({
        section: "recurring",
        action: {
          kind: "track-recurring",
          prefill: {
            name: "Gym",
            type: "EXPENSE",
            amountCents: 4_000,
            cadence: "MONTHLY",
            accountId: null,
            categoryId: "c1",
            nextExpectedDate: "2026-11-15",
          },
        },
      }),
    );
    expect(track.website).toEqual({ path: "/insights#insights-recurring", label: "Track it" });
    expect(serializeAppInsight(view()).website).toBeNull();
  });

  it("gives absent amounts as null, evidence types in lower case and an untitled row no title", () => {
    const out = serializeAppInsight(view());
    expect(out).toMatchObject({ monthlyCents: 2_099, annualCents: null, savingCents: null });
    expect(out.evidence).toEqual([{ id: "t1", date: "2026-10-12", title: null, amountCents: 2_099, type: "expense" }]);
  });

  it("says how long a hidden one is hidden for, and leaves that off one that shows", () => {
    expect(serializeAppInsight(view({ dismissedUntil: "2026-12-03" })).hiddenUntil).toBe("2026-12-03");
    expect(serializeAppInsight(view({ dismissedUntil: null })).hiddenUntil).toBeNull();
    expect(serializeAppInsight(view())).not.toHaveProperty("hiddenUntil");
  });
});

describe("serializeAppScore", () => {
  const scored: FinancialScore = {
    status: "scored",
    score: 71,
    band: "Good",
    months: ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"],
    factors: [
      { id: "savings", pillar: "spend", label: "Savings rate", score: 82, weight: 0.6, detail: "18% of income saved", suggestion: null },
      { id: "emergency", pillar: "save", label: "Emergency fund", score: 40, weight: 0.4, detail: "1.2 months", suggestion: "Build it up" },
    ],
    pillars: [
      { id: "spend", label: "Spend", score: 82, weight: 0.6, note: null },
      { id: "save", label: "Save", score: 40, weight: 0.4, note: null },
      { id: "borrow", label: "Borrow", score: null, weight: 0, note: "No debt carried" },
      { id: "plan", label: "Plan", score: null, weight: 0, note: null },
    ],
    suggestions: ["Build it up"],
    omitted: [{ label: "Budgets", reason: "no budgets set" }],
    cushion: { fundCents: 300_000, monthlySpendingCents: 250_000 },
    emergencyTargetMonths: 3,
    monthsInBlack: { positive: 4, total: 6 },
    split: null,
    otherCurrencyAccounts: [],
    change: { fromMonth: "2026-09", fromScore: 68, mover: { label: "Savings rate", delta: 6 } },
  };

  it("bands every pillar and factor with the website's thresholds, and none for an unscored pillar", () => {
    const out = serializeAppScore(scored, "CAD");
    if (out.status !== "scored") throw new Error("expected a score");
    expect(out.pillars.map((p) => p.band)).toEqual(["Strong", "Needs work", null, null]);
    expect(out.factors.map((f) => f.band)).toEqual(["Strong", "Needs work"]);
    expect(out).toMatchObject({ score: 71, band: "Good", currency: "CAD", change: { fromScore: 68 } });
  });

  it("passes on why there is no score yet", () => {
    expect(serializeAppScore({ status: "insufficient", reason: "Needs a full month" }, "CAD")).toEqual({
      status: "insufficient",
      currency: "CAD",
      reason: "Needs a full month",
    });
  });
});

describe("parseDismissBody / parseRestoreBody", () => {
  it("dismisses for good unless told to snooze, and refuses an empty key", () => {
    expect(parseDismissBody({ key: "k" })).toEqual({ ok: true, value: { key: "k", mode: "forever" } });
    expect(parseDismissBody({ key: "k", mode: "snooze" })).toEqual({ ok: true, value: { key: "k", mode: "snooze" } });
    expect(parseDismissBody({ key: " ", mode: "snooze" }).ok).toBe(false);
    expect(parseDismissBody({ key: "k", mode: "later" }).ok).toBe(false);
    expect(parseRestoreBody({ key: "k" })).toEqual({ ok: true, value: { key: "k" } });
  });
});
