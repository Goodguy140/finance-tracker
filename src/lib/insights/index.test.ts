import { describe, expect, it, vi } from "vitest";
import { NOW, tx } from "./test-fixtures";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { buildInsights } = await import("./index");
const { moneyFormatter } = await import("./util");

const txs = [
  ...["2026-06-15", "2026-07-15", "2026-08-15", "2026-09-15"].map((d) => tx(d, "Netflix", 1899)),
  ...["2026-07-10", "2026-08-10", "2026-09-10"].map((d) => tx(d, "SQDC", 4000)),
];
const base = { txs, rules: [], budgets: [], now: NOW, fmt: moneyFormatter(), habitsEnabled: true, dismissals: [] };

describe("buildInsights", () => {
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
});
