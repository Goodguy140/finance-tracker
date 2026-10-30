import { describe, expect, it } from "vitest";
import { FACTOR_PILLAR, type FinancialScore, type FinancialScoreFactor } from "@/lib/financial-score";
import type { GoalProgress } from "@/lib/savings-goals";
import { detectStanding, type StandingInput } from "./standing";
import { NOW, tx } from "./test-fixtures";
import { moneyFormatter } from "./util";

// NOW is 2026-09-25.
const fmt = moneyFormatter();
const day = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
const run = (input: Partial<StandingInput>) =>
  detectStanding({ txs: [], now: NOW, fmt, owed: null, room: null, score: null, goals: null, ...input });

describe("money owed to you", () => {
  const share = (name: string, amountCents: number, ymd: string) => ({ name, amountCents, date: day(ymd), title: "Cottage" });

  it("reminds once the oldest share is a month old, counting people once", () => {
    const [owed] = run({ owed: [share("Sam", 6_000, "2026-08-10"), share("Ana", 5_000, "2026-09-01"), share("sam", 3_000, "2026-09-20")] });
    expect(owed).toMatchObject({ key: "owed:2026-08-10:sam", severity: "low", title: `2 people owe you ${fmt(14_000)}` });
    expect(owed.body).toContain(`Sam's ${fmt(6_000)} for Cottage, is from Aug 10, 46 days ago`);
  });

  it("waits while everything owed is recent", () => {
    expect(run({ owed: [share("Sam", 6_000, "2026-09-10")] })).toEqual([]);
  });
});

describe("registered account deadlines", () => {
  it("mentions RRSP room left for last year in the first 60 days", () => {
    const room = { entries: [{ accountType: "RRSP" as const, year: 2026, roomCents: 500_000 }], flows: [], types: ["RRSP" as const] };
    const [rrsp] = run({ room, now: new Date("2027-02-10T12:00:00.000Z") });
    expect(rrsp).toMatchObject({ key: "room:rrsp:2026", section: "ahead", title: `${fmt(500_000)} of RRSP room left for 2026` });
    expect(rrsp.body).toContain("March 1, 2027");
    expect(run({ room, now: new Date("2027-03-15T12:00:00.000Z") })).toEqual([]);
  });

  it("warns in the last two months of FHSA room that will not carry over", () => {
    const room = { entries: [{ accountType: "FHSA" as const, year: 2026, roomCents: 1_600_000 }], flows: [], types: ["FHSA" as const] };
    const [fhsa] = run({ room, now: new Date("2026-11-20T12:00:00.000Z") });
    expect(fhsa).toMatchObject({ key: "room:fhsa:2026", title: `${fmt(800_000)} of FHSA room ends on December 31` });
    expect(run({ room })).toEqual([]);
  });
});

const factor = (id: FinancialScoreFactor["id"], score: number, detail = ""): FinancialScoreFactor => ({
  id,
  pillar: FACTOR_PILLAR[id],
  label: id,
  score,
  weight: 0.5,
  detail,
  suggestion: null,
});
const scored = (
  factors: FinancialScoreFactor[],
  cushion: { fundCents: number; monthlySpendingCents: number } | null = null,
  monthsInBlack = { positive: 0, total: 0 },
): FinancialScore => ({
  status: "scored",
  pillars: [],
  emergencyTargetMonths: 3,
  monthsInBlack,
  split: null,
  change: null,
  score: 80,
  band: "Good",
  months: ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08"],
  factors,
  suggestions: [],
  omitted: [],
  cushion,
  otherCurrencyAccounts: [],
});

describe("idle cash", () => {
  it("points out cash well past six months of spending", () => {
    const [idle] = run({ score: scored([], { fundCents: 3_000_000, monthlySpendingCents: 300_000 }) });
    expect(idle).toMatchObject({ key: "cash:idle:2026-08", section: "saving", title: `About ${fmt(1_200_000)} more cash than a 6-month cushion` });
    expect(run({ score: scored([], { fundCents: 2_000_000, monthlySpendingCents: 300_000 }) })).toEqual([]);
  });
});

describe("savings goals", () => {
  const progress = (overrides: Partial<GoalProgress>): GoalProgress => ({
    savedCents: 100_000,
    remainingCents: 400_000,
    fraction: 0.2,
    status: "behind",
    monthsLeft: 4,
    monthlyNeededCents: 100_000,
    monthlyPaceCents: 20_000,
    monthlyTransferCents: null,
    projectedYmd: null,
    paceSource: "balance",
    ...overrides,
  });
  const goal = (p: Partial<GoalProgress>) => ({ id: "g1", name: "Trip", targetCents: 500_000, targetYmd: "2027-01-31", progress: progress(p) });

  it("raises a goal falling behind, with what it needs a month", () => {
    const [behind] = run({ goals: [goal({})] });
    expect(behind).toMatchObject({ key: "goal:behind:g1:2026-09", title: "Trip is behind", monthlyCents: 100_000 });
    expect(behind.body).toContain(`about ${fmt(100_000)} a month; lately it has grown about ${fmt(20_000)} a month`);
    expect(run({ goals: [goal({ status: "on-track" })] })).toEqual([]);
  });
});

describe("good news", () => {
  it("notes a category well down on its usual", () => {
    const txs = [
      ...["2026-05", "2026-06", "2026-07"].map((m) => tx(`${m}-10`, "Bistro", 40_000, { categoryId: "d", categoryName: "Dining" })),
      tx("2026-08-10", "Bistro", 20_000, { categoryId: "d", categoryName: "Dining" }),
    ];
    const [good] = run({ txs });
    expect(good).toMatchObject({ key: "good:down:d:2026-08", section: "good", title: "Dining was down 50% last month" });
  });

  it("does not count a one-off that did not repeat", () => {
    const txs = [
      tx("2026-05-10", "Bistro", 40_000, { categoryId: "d", categoryName: "Dining" }),
      tx("2026-06-10", "Store", 1_000),
      tx("2026-07-10", "Store", 1_000),
      tx("2026-08-10", "Store", 1_000),
    ];
    expect(run({ txs })).toEqual([]);
  });

  it("celebrates every month in the black and every budget kept", () => {
    const keys = run({
      score: scored([factor("buffer", 70), factor("budgets", 100, "6 of 6 monthly budgets kept in the last 3 months")], null, { positive: 6, total: 6 }),
    }).map((i) => i.key);
    expect(keys).toEqual(["good:black:2026-08", "good:budgets:2026-08"]);
    expect(run({ score: scored([factor("consistency", 80), factor("budgets", 90)], null, { positive: 5, total: 6 }) })).toEqual([]);
  });
});
