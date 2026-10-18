import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT } from "./cards";
import { filterToAvailable, reconcileDashboardLayout } from "./normalize";
import { CARD_IDS, type DashboardCardId, type DashboardLayout } from "./schema";
import { addCard, canAddCardTo, canRemoveCard, hiddenCards, isCardPlaced, removeCard, removedCardsInOrder } from "./visibility";

const ALL: readonly DashboardCardId[] = CARD_IDS;

function fresh(): DashboardLayout {
  return JSON.parse(JSON.stringify(DEFAULT_LAYOUT)) as DashboardLayout;
}

function placement(layout: DashboardLayout): DashboardCardId[][] {
  return layout.columns.map((column) => column.slots.flatMap((slot) => slot.cards));
}

function slotOf(layout: DashboardLayout, cardId: DashboardCardId) {
  return layout.columns.flatMap((column) => column.slots).find((slot) => slot.cards.includes(cardId));
}

/** Round-trips through the saved blob and the reconciler, the way the next page load does. */
function reload(layout: DashboardLayout, available: readonly DashboardCardId[] = ALL) {
  return reconcileDashboardLayout(JSON.stringify(layout), available);
}

describe("removeCard", () => {
  it("takes the card off the dashboard and keeps it off across a reload", () => {
    const removed = removeCard(fresh(), "insights");

    expect(placement(removed).flat()).not.toContain("insights");
    expect(hiddenCards(removed)).toEqual(["insights"]);

    const { stored, rendered, changed } = reload(removed);
    expect(placement(stored).flat()).not.toContain("insights");
    expect(placement(rendered).flat()).not.toContain("insights");
    expect(stored.hidden).toEqual(["insights"]);
    expect(changed).toBe(false);
  });

  it("is the difference from a card the page did not render: only the removed one stays gone", () => {
    // Income is missing from a month with no income, so it is not in `available`. Removing
    // Recurring is a choice. Next month, with income, Income is back and Recurring is not.
    const removed = removeCard(fresh(), "recurring");
    const emptyMonth = reload(removed, ALL.filter((id) => id !== "income"));
    expect(placement(emptyMonth.rendered).flat()).not.toContain("income");
    expect(placement(emptyMonth.stored).flat()).toContain("income");

    const nextMonth = reload(emptyMonth.stored);
    expect(placement(nextMonth.rendered).flat()).toContain("income");
    expect(placement(nextMonth.rendered).flat()).not.toContain("recurring");
  });

  it("takes one tab out of a stack and leaves the rest of the stack", () => {
    const layout = fresh();
    layout.columns[1].slots[0] = { id: "slot-stack", cards: ["budgets", "spending-by-category", "income"], activeIndex: 2 };
    layout.columns[1].slots.splice(1, 2);

    const removed = removeCard(layout, "spending-by-category");
    const stack = slotOf(removed, "budgets");
    expect(stack?.cards).toEqual(["budgets", "income"]);
    // Income was on screen and still is, one position earlier.
    expect(stack?.activeIndex).toBe(1);
  });

  it("shows the neighbouring tab when the tab on screen is removed", () => {
    const layout = fresh();
    layout.columns[1].slots[0] = { id: "slot-stack", cards: ["budgets", "spending-by-category"], activeIndex: 1 };
    layout.columns[1].slots.splice(1, 1);

    const stack = slotOf(removeCard(layout, "spending-by-category"), "budgets");
    expect(stack?.cards).toEqual(["budgets"]);
    expect(stack?.activeIndex).toBe(0);
  });

  it("drops a slot left empty but keeps its column, which is still somewhere to put things", () => {
    const layout = fresh();
    layout.columns.push({ id: "col-3", weight: 6, slots: [{ id: "slot-only", cards: ["insights"], activeIndex: 0 }] });
    layout.columns[0].slots = layout.columns[0].slots.filter((slot) => !slot.cards.includes("insights"));

    const removed = removeCard(layout, "insights");
    expect(removed.columns).toHaveLength(3);
    expect(removed.columns[2].slots).toEqual([]);
  });

  it("keeps the card's settings, so adding it back restores them", () => {
    const layout = { ...fresh(), settings: { insights: { maxItems: 8 as const } } };
    const removed = reload(removeCard(layout, "insights")).stored;
    expect(removed.settings.insights).toEqual({ maxItems: 8 });
  });

  it("refuses to remove the last card on the dashboard", () => {
    const layout: DashboardLayout = {
      version: 1,
      columns: [{ id: "c", weight: 24, slots: [{ id: "s", cards: ["budgets"], activeIndex: 0 }] }],
      hidden: CARD_IDS.filter((id) => id !== "budgets"),
      settings: {},
    };
    expect(canRemoveCard(layout, "budgets")).toBe(false);
    expect(removeCard(layout, "budgets")).toBe(layout);
  });

  it("does nothing for a card that is not on the dashboard", () => {
    const removed = removeCard(fresh(), "insights");
    expect(removeCard(removed, "insights")).toBe(removed);
  });
});

describe("addCard", () => {
  it("puts a removed card back at the bottom of a column", () => {
    const removed = removeCard(fresh(), "insights");
    const added = addCard(removed, "insights", { kind: "column", columnId: "col-side" });

    expect(placement(added)[1].at(-1)).toBe("insights");
    expect(hiddenCards(added)).toEqual([]);
    expect(added.hidden).toBeUndefined();
    expect(placement(reload(added).stored)[1].at(-1)).toBe("insights");
  });

  it("adds a removed card as a tab and shows it", () => {
    const removed = removeCard(fresh(), "insights");
    const added = addCard(removed, "insights", { kind: "tab", slotId: "slot-budgets" });

    const stack = slotOf(added, "budgets");
    expect(stack?.cards).toEqual(["budgets", "insights"]);
    expect(stack?.activeIndex).toBe(1);
  });

  it("gives the new slot an id no other slot has", () => {
    // Insights moved into another slot leaves its old slot id free in name only: a later
    // card of the same id must not reuse an id still in the layout.
    const layout = fresh();
    layout.columns[1].slots.push({ id: "slot-insights", cards: ["recurring"], activeIndex: 0 });
    layout.columns[1].slots = layout.columns[1].slots.filter((slot) => slot.id !== "slot-recurring");
    layout.columns[0].slots = layout.columns[0].slots.filter((slot) => slot.id !== "slot-insights");
    const withHidden: DashboardLayout = { ...layout, hidden: ["insights"] };

    const added = addCard(withHidden, "insights", { kind: "column", columnId: "col-main" });
    const ids = added.columns.flatMap((column) => column.slots.map((slot) => slot.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("refuses a card that was not removed, or a full stack", () => {
    const layout = fresh();
    expect(addCard(layout, "insights", { kind: "column", columnId: "col-side" })).toBe(layout);

    const full: DashboardLayout = {
      ...fresh(),
      hidden: ["insights"],
    };
    full.columns[1].slots[0] = {
      id: "slot-full",
      cards: ["budgets", "spending-by-category", "income", "recurring", "add-expense", "expense-log", "cumulative-spend", "bills-forecast"],
      activeIndex: 0,
    };
    full.columns[1].slots.splice(1);
    full.columns[0].slots = full.columns[0].slots.filter((slot) => slot.id === "slot-insights");
    expect(canAddCardTo(full, { kind: "tab", slotId: "slot-full" })).toBe(false);
  });
});

describe("reconciling removed cards", () => {
  it("drops unknown ids and ids that are also placed, preferring what is on screen", () => {
    const blob = { ...fresh(), hidden: ["retired-card", "budgets", "insights", "insights"] };
    blob.columns[0].slots = blob.columns[0].slots.filter((slot) => !slot.cards.includes("insights"));
    const { stored, changed } = reconcileDashboardLayout(JSON.stringify(blob), ALL);

    expect(stored.hidden).toEqual(["insights"]);
    expect(placement(stored).flat()).toContain("budgets");
    expect(changed).toBe(true);
  });

  it("survives a hidden list that is not a list, keeping the arrangement", () => {
    const blob = { ...fresh(), hidden: "insights" };
    const { stored } = reconcileDashboardLayout(JSON.stringify(blob), ALL);
    expect(placement(stored)).toEqual(placement(DEFAULT_LAYOUT));
  });

  it("carries the removed list through the render copy", () => {
    const removed = removeCard(fresh(), "insights");
    expect(filterToAvailable(removed, ALL).hidden).toEqual(["insights"]);
  });

  it("lists removed cards in registry order", () => {
    const layout = removeCard(removeCard(fresh(), "recurring"), "budgets");
    expect(removedCardsInOrder(layout)).toEqual(["budgets", "recurring"]);
  });
});

describe("isCardPlaced", () => {
  it("is true for a card on the dashboard, a tab included, and false once removed", () => {
    // Investments is a tab beside Insights in the default layout.
    expect(isCardPlaced(fresh(), "insights")).toBe(true);
    expect(isCardPlaced(fresh(), "investments")).toBe(true);
    const removed = removeCard(fresh(), "insights");
    expect(isCardPlaced(removed, "insights")).toBe(false);
    expect(isCardPlaced(reconcileDashboardLayout(JSON.stringify(removed), ALL).stored, "insights")).toBe(false);
  });
});
