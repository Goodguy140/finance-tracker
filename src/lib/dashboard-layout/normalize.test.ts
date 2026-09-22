import { describe, expect, it } from "vitest";
import { CARD_IDS, type DashboardCardId, type DashboardLayout, TOTAL_COLUMN_UNITS } from "./schema";
import { DEFAULT_LAYOUT } from "./cards";
import { filterToAvailable, layoutForRenderedColumns, reconcileDashboardLayout } from "./normalize";

const ALL: readonly DashboardCardId[] = CARD_IDS;

/** Every card id in the layout, column by column — the shape every assertion here checks. */
function placement(layout: DashboardLayout): DashboardCardId[][] {
  return layout.columns.map((column) => column.slots.flatMap((slot) => slot.cards));
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

/** The default layout as a blob, for tests that start from something valid. */
function defaultBlob(): DashboardLayout {
  return JSON.parse(JSON.stringify(DEFAULT_LAYOUT)) as DashboardLayout;
}

describe("reconcileDashboardLayout — unusable input", () => {
  it("falls back to the default layout for null, malformed JSON, and a wrong shape", () => {
    for (const raw of [null, "{", "[]", '"nope"', json({ version: 1 }), json({ version: 1, columns: [] })]) {
      expect(reconcileDashboardLayout(raw, ALL).stored).toEqual(DEFAULT_LAYOUT);
    }
  });

  it("falls back rather than guessing at a blob from a newer release", () => {
    const future = json({ ...defaultBlob(), version: 99 });
    expect(reconcileDashboardLayout(future, ALL).stored).toEqual(DEFAULT_LAYOUT);
  });

  it("reports changed only when there was something to replace", () => {
    expect(reconcileDashboardLayout(null, ALL).changed).toBe(false);
    expect(reconcileDashboardLayout("{", ALL).changed).toBe(true);
  });

  it("accepts the default layout unchanged", () => {
    const result = reconcileDashboardLayout(json(defaultBlob()), ALL);
    expect(result.stored).toEqual(DEFAULT_LAYOUT);
    expect(result.changed).toBe(false);
  });
});

describe("reconcileDashboardLayout — card drift", () => {
  it("drops a card id this release no longer knows, leaving every other position intact", () => {
    const blob = defaultBlob();
    blob.columns[0].slots.push({ id: "slot-retired", cards: ["retired-card" as DashboardCardId], activeIndex: 0 });
    const result = reconcileDashboardLayout(json(blob), ALL);

    expect(placement(result.stored)).toEqual(placement(DEFAULT_LAYOUT));
    expect(result.changed).toBe(true);
  });

  it("appends a card missing from the blob at its registry position", () => {
    const blob = defaultBlob();
    blob.columns[1].slots = blob.columns[1].slots.filter((slot) => !slot.cards.includes("recurring"));
    const result = reconcileDashboardLayout(json(blob), ALL);

    expect(placement(result.stored)[1]).toContain("recurring");
    expect(placement(result.stored)).toEqual(placement(DEFAULT_LAYOUT));
    expect(result.changed).toBe(true);
  });

  it("keeps a duplicated card once, in the slot it appeared in first", () => {
    const blob = defaultBlob();
    blob.columns[0].slots.unshift({ id: "slot-dupe", cards: ["budgets"], activeIndex: 0 });
    const result = reconcileDashboardLayout(json(blob), ALL);

    expect(placement(result.stored)[0][0]).toBe("budgets");
    expect(placement(result.stored).flat().filter((id) => id === "budgets")).toEqual(["budgets"]);
    expect(result.changed).toBe(true);
  });

  it("clamps a stack's active index into range", () => {
    const blob = defaultBlob();
    blob.columns[0].slots[0] = { id: "slot-stack", cards: ["cumulative-spend", "add-expense"], activeIndex: 7 };
    const result = reconcileDashboardLayout(json(blob), ALL);

    expect(result.stored.columns[0].slots[0].activeIndex).toBe(1);
  });
});

describe("reconcileDashboardLayout — the conditional-card regression", () => {
  // The Income card is absent whenever the selected period has no income. Treating that
  // as "the user removed it" would delete their card the first time they viewed an empty
  // month, so `stored` must never be filtered by what happens to be renderable.
  it("hides an unavailable card from `rendered` while keeping it in `stored`", () => {
    const available = ALL.filter((id) => id !== "income");
    const result = reconcileDashboardLayout(json(defaultBlob()), available);

    expect(placement(result.stored).flat()).toContain("income");
    expect(placement(result.rendered).flat()).not.toContain("income");
  });

  it("round-tripping a period with no income does not lose the card", () => {
    const withoutIncome = ALL.filter((id) => id !== "income");
    const first = reconcileDashboardLayout(json(defaultBlob()), withoutIncome);
    // What a save would write back, re-read in a period that does have income.
    const second = reconcileDashboardLayout(json(first.stored), ALL);

    expect(placement(second.rendered).flat()).toContain("income");
    expect(placement(second.stored)).toEqual(placement(DEFAULT_LAYOUT));
  });
});

describe("reconcileDashboardLayout — weights and columns", () => {
  it("repairs weights that do not sum to the grid", () => {
    const blob = defaultBlob();
    blob.columns[0].weight = 30;
    blob.columns[1].weight = 30;
    const result = reconcileDashboardLayout(json(blob), ALL);

    const sum = result.stored.columns.reduce((acc, c) => acc + c.weight, 0);
    expect(sum).toBe(TOTAL_COLUMN_UNITS);
    expect(result.changed).toBe(true);
  });

  it("drops an empty column instead of rendering a gap", () => {
    const blob = defaultBlob();
    blob.columns.push({ id: "col-empty", weight: 6, slots: [] });
    const result = reconcileDashboardLayout(json(blob), ALL);

    expect(result.stored.columns).toHaveLength(2);
    expect(result.stored.columns.map((c) => c.id)).toEqual(["col-main", "col-side"]);
  });

  it("discards settings for a card id that no longer exists", () => {
    const blob = defaultBlob() as DashboardLayout & { settings: Record<string, unknown> };
    blob.settings = { budgets: { perRow: 2 }, "retired-card": { nope: true } };
    const result = reconcileDashboardLayout(json(blob), ALL);

    expect(Object.keys(result.stored.settings)).toEqual(["budgets"]);
    expect(result.stored.settings.budgets).toEqual({ perRow: 2 });
  });

  it("keeps a valid per-card setting and defaults a corrupt one without losing the rest", () => {
    const blob = defaultBlob() as DashboardLayout & { settings: Record<string, unknown> };
    blob.settings = { budgets: { perRow: 99 }, "expense-log": { density: "compact" } } as unknown as DashboardLayout["settings"];
    const result = reconcileDashboardLayout(json(blob), ALL);

    expect(result.stored.settings.budgets?.perRow).toBe(1);
    expect(result.stored.settings["expense-log"]?.density).toBe("compact");
  });
});

describe("filterToAvailable", () => {
  it("returns a copy and never mutates the layout it was given", () => {
    const layout = defaultBlob();
    const before = json(layout);
    filterToAvailable(layout, ["budgets"]);
    expect(json(layout)).toBe(before);
  });

  it("collapses an empty column away for normal viewing", () => {
    const layout = defaultBlob();
    // Only the side column's cards survive, so the main column empties out.
    const filtered = filterToAvailable(layout, ["budgets", "spending-by-category"]);
    expect(filtered.columns).toHaveLength(1);
  });

  it("keeps an empty column while editing, so it can be dropped onto", () => {
    const layout = defaultBlob();
    layout.columns.push({ id: "col-new", weight: 6, slots: [] });
    const filtered = filterToAvailable(layout, ALL, { keepEmptyColumns: true });

    expect(filtered.columns.map((c) => c.id)).toEqual(["col-main", "col-side", "col-new"]);
    expect(filtered.columns[2].slots).toEqual([]);
  });

  it("collapses a stack down to the cards that are actually available", () => {
    const layout = defaultBlob();
    layout.columns[0].slots[0] = { id: "s", cards: ["cumulative-spend", "income"], activeIndex: 1 };
    const filtered = filterToAvailable(layout, ALL.filter((id) => id !== "income"));

    expect(filtered.columns[0].slots[0].cards).toEqual(["cumulative-spend"]);
    expect(filtered.columns[0].slots[0].activeIndex).toBe(0);
  });
});

describe("layoutForRenderedColumns", () => {
  it("folds every card into one column when only one fits", () => {
    const collapsed = layoutForRenderedColumns(defaultBlob(), 1);
    expect(collapsed.columns).toHaveLength(1);
    expect(placement(collapsed)[0]).toEqual([
      "cumulative-spend",
      "add-expense",
      "expense-log",
      "budgets",
      "spending-by-category",
      "income",
      "recurring",
    ]);
  });

  it("loses no card at any rendered column count", () => {
    const layout = defaultBlob();
    const everyCard = placement(layout).flat().sort();
    for (const count of [1, 2, 3, 4]) {
      expect(placement(layoutForRenderedColumns(layout, count)).flat().sort()).toEqual(everyCard);
    }
  });
});
