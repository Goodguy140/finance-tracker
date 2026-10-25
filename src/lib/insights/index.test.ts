import { describe, expect, it, vi } from "vitest";
import { NOW, tx } from "./test-fixtures";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { buildInsights, compareBySeverity } = await import("./index");
import type { Insight } from "./types";
const { insightsNow, moneyFormatter } = await import("./util");

const txs = [
  ...["2026-06-15", "2026-07-15", "2026-08-15", "2026-09-15"].map((d) => tx(d, "Netflix", 1899)),
  ...["2026-07-10", "2026-08-10", "2026-09-10"].map((d) => tx(d, "SQDC", 4000)),
];
const base = { txs, rules: [], budgets: [], now: NOW, fmt: moneyFormatter(), habitsEnabled: true, dismissals: [] };

describe("buildInsights", () => {
  it("counts a recently cancelled subscription under Going well", () => {
    const cancelledAt = new Date(NOW.getTime() - 5 * 86_400_000);
    const { visible } = buildInsights({
      ...base,
      rules: [
        { id: "gym", name: "Gym", type: "EXPENSE", amountCents: 5_000, cadence: "MONTHLY", enabled: false, categoryId: "c", cancelledAt },
      ],
    });
    expect(visible.find((i) => i.key === "good:cancelled:gym")).toMatchObject({ section: "good", annualCents: 60_000 });
  });

  it("orders sections recurring, habit, saving, improvement", () => {
    const { visible } = buildInsights(base);
    expect(visible.map((i) => i.key)).toEqual(expect.arrayContaining(["recurring:EXPENSE:netflix", "habit:CANNABIS"]));
    expect(visible[0].section).toBe("recurring");
  });

  it("does not compute habits when turned off", () => {
    const { visible, dismissed } = buildInsights({ ...base, habitsEnabled: false });
    expect([...visible, ...dismissed].some((i) => i.section === "habit")).toBe(false);
  });

  it("moves dismissed and snoozed keys aside until a snooze runs out", () => {
    const forever = buildInsights({ ...base, dismissals: [{ insightKey: "habit:CANNABIS", snoozedUntil: null }] });
    expect(forever.visible.some((i) => i.key === "habit:CANNABIS")).toBe(false);
    expect(forever.dismissed.map((i) => i.key)).toEqual(["habit:CANNABIS"]);

    const snoozed = buildInsights({
      ...base,
      dismissals: [{ insightKey: "habit:CANNABIS", snoozedUntil: new Date("2026-10-01T00:00:00Z") }],
    });
    expect(snoozed.visible.some((i) => i.key === "habit:CANNABIS")).toBe(false);

    const expired = buildInsights({
      ...base,
      dismissals: [{ insightKey: "habit:CANNABIS", snoozedUntil: new Date("2026-09-01T00:00:00Z") }],
    });
    expect(expired.visible.some((i) => i.key === "habit:CANNABIS")).toBe(true);
  });

  it("checks snoozes against the real clock, not the noon the detectors work from", () => {
    // The detectors' "now" is noon on the user's date; the snooze ran out at 18:00 UTC, before
    // the clock but after that noon.
    const { visible } = buildInsights({
      ...base,
      clock: new Date("2026-09-25T20:00:00.000Z"),
      dismissals: [{ insightKey: "habit:CANNABIS", snoozedUntil: new Date("2026-09-25T18:00:00.000Z") }],
    });
    expect(visible.some((i) => i.key === "habit:CANNABIS")).toBe(true);
  });
});

describe("rows dated ahead", () => {
  it("are left out until their day comes", () => {
    const gym = ["2026-06-20", "2026-07-20", "2026-08-20", "2026-09-20"].map((d) => tx(d, "Gymbox", 4500));
    const logged = (rows: typeof gym) =>
      buildInsights({ ...base, txs: rows }).visible.find((i) => i.key === "recurring:EXPENSE:gymbox")?.body;
    expect(logged([...gym, tx("2026-10-20", "Gymbox", 4500)])).toBe(logged(gym));
    expect(logged(gym)).toContain("4 times so far");
  });
});

describe("compareBySeverity", () => {
  it("puts the most pressing first, then the biggest", () => {
    const make = (key: string, severity: Insight["severity"], annualCents: number): Insight => ({
      key,
      section: "saving",
      severity,
      title: key,
      body: "",
      annualCents,
      evidenceTxIds: [],
    });
    const sorted = [make("a", "low", 90000), make("b", "medium", 1000), make("c", "medium", 5000), make("d", "high", 10)]
      .sort(compareBySeverity)
      .map((i) => i.key);
    expect(sorted).toEqual(["d", "c", "b", "a"]);
  });
});

describe("dismissals that come back when an insight grows", () => {
  // Cannabis comes to 12,000 in the window: about 4,058 a month, 48,700 a year.
  const habitSize = () => buildInsights(base).visible.find((i) => i.key === "habit:CANNABIS")!.annualCents!;

  it("stays hidden while the insight is about the size it was dismissed at", () => {
    const size = habitSize();
    const { visible } = buildInsights({ ...base, dismissals: [{ insightKey: "habit:CANNABIS", snoozedUntil: null, dismissedCents: size }] });
    expect(visible.some((i) => i.key === "habit:CANNABIS")).toBe(false);
  });

  it("shows again once it is half as big again as when dismissed", () => {
    const size = habitSize();
    const grown = buildInsights({
      ...base,
      dismissals: [{ insightKey: "habit:CANNABIS", snoozedUntil: null, dismissedCents: Math.floor(size / 1.5) }],
    });
    expect(grown.visible.some((i) => i.key === "habit:CANNABIS")).toBe(true);
    expect(grown.dismissed.some((i) => i.key === "habit:CANNABIS")).toBe(false);
  });

  it("keeps a dismissal with no size recorded hidden for good, as before", () => {
    const { visible } = buildInsights({ ...base, dismissals: [{ insightKey: "habit:CANNABIS", snoozedUntil: null, dismissedCents: null }] });
    expect(visible.some((i) => i.key === "habit:CANNABIS")).toBe(false);
  });
});

describe("insightsNow", () => {
  it("is the user's own date, so the 31st in Toronto is still the 31st", () => {
    // 21:30 on 31 October in Toronto is already 1 November in UTC.
    const clock = new Date("2026-11-01T01:30:00.000Z");
    expect(insightsNow("America/Toronto", clock).toISOString()).toBe("2026-10-31T12:00:00.000Z");
    expect(insightsNow("UTC", clock).toISOString()).toBe("2026-11-01T12:00:00.000Z");
  });
});

describe("score suggestions", () => {
  const months = ["2026-06", "2026-07", "2026-08"];
  const overspent = months.flatMap((m) => [
    tx(`${m}-01`, "Payroll", 300000, { type: "INCOME", categoryId: "s", categoryName: "Salary" }),
    tx(`${m}-02`, "Rent", 320000, { categoryId: "r", categoryName: "Rent" }),
  ]);
  const fromScore: Insight = {
    key: "score:consistency:2026-09",
    section: "improvement",
    severity: "high",
    title: "Months in the black: 0 of 3 months ended with money left over",
    body: "Spent more than earned.",
    evidenceTxIds: [],
  };

  it("join the list, and stand in for the engine's own savings rate", () => {
    const own = buildInsights({ ...base, txs: overspent }).visible.map((i) => i.key);
    expect(own).toContain("improve:savings-rate:2026-08");

    const withScore = buildInsights({ ...base, txs: overspent, scoreInsights: [fromScore] }).visible.map((i) => i.key);
    expect(withScore).toContain("score:consistency:2026-09");
    expect(withScore.some((k) => k.startsWith("improve:savings-rate"))).toBe(false);
  });
});
