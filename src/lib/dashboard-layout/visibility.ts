import { enforceMinimums } from "./columns";
import {
  CARD_IDS,
  type DashboardCardId,
  type DashboardLayout,
  type DashboardSlot,
  MAX_CARDS_PER_SLOT,
  MAX_SLOTS_PER_COLUMN,
  isDashboardCardId,
} from "./schema";

/**
 * Taking cards off the dashboard and putting them back.
 *
 * A removed card goes into `hidden`, which is what stops the reconciler re-adding it on the
 * next load. That is a different thing from a card the page did not render this time (Income
 * in a month with no income): that one stays in its slot and comes back by itself, while a
 * removed one stays gone until the user adds it back.
 *
 * Pure functions over the stored layout, so the grid can apply them through its usual
 * mutate-then-save path and the rules are tested without a browser.
 */

export function hiddenCards(layout: DashboardLayout): DashboardCardId[] {
  return (layout.hidden ?? []).filter(isDashboardCardId);
}

function withHidden(layout: DashboardLayout, hidden: readonly DashboardCardId[]): DashboardLayout {
  const { hidden: _previous, ...rest } = layout;
  void _previous;
  return hidden.length > 0 ? { ...rest, hidden: [...hidden] } : rest;
}

function placedCards(layout: DashboardLayout): DashboardCardId[] {
  return layout.columns.flatMap((column) => column.slots.flatMap((slot) => slot.cards));
}

/** Whether a card is on the dashboard: in a slot, as its own card or a tab of a stack. */
export function isCardPlaced(layout: DashboardLayout, cardId: DashboardCardId): boolean {
  return placedCards(layout).includes(cardId);
}

/** The last card on the dashboard cannot be removed: an empty dashboard has no way back. */
export function canRemoveCard(layout: DashboardLayout, cardId: DashboardCardId): boolean {
  const placed = placedCards(layout);
  return placed.includes(cardId) && placed.length > 1;
}

/**
 * Takes a card off the dashboard. A card in a stack leaves the stack and the rest stay; a slot
 * left with nothing in it goes. Its column stays even when emptied, because this only happens
 * in edit mode, where an empty column is still somewhere to put things. Its settings are kept,
 * so adding it back restores them.
 */
export function removeCard(layout: DashboardLayout, cardId: DashboardCardId): DashboardLayout {
  if (!canRemoveCard(layout, cardId)) return layout;
  const columns = layout.columns.map((column) => ({
    ...column,
    slots: column.slots
      .map((slot): DashboardSlot => {
        const index = slot.cards.indexOf(cardId);
        if (index === -1) return slot;
        const cards = slot.cards.filter((card) => card !== cardId);
        // Removing the tab on screen shows its neighbour; removing one before it keeps the same
        // tab on screen.
        const activeIndex =
          index < slot.activeIndex ? slot.activeIndex - 1 : Math.min(slot.activeIndex, Math.max(cards.length - 1, 0));
        return { ...slot, cards, activeIndex };
      })
      .filter((slot) => slot.cards.length > 0),
  }));
  const hidden = hiddenCards(layout).filter((id) => id !== cardId);
  return withHidden({ ...layout, columns: enforceMinimums(columns) }, [...hidden, cardId]);
}

export type AddCardTarget =
  /** A card of its own at the bottom of a column. */
  | { kind: "column"; columnId: string }
  /** A new tab on an existing card, which becomes a stack if it was not one. */
  | { kind: "tab"; slotId: string };

/** Where a removed card can go back right now, honouring the per-column and per-stack caps. */
export function canAddCardTo(layout: DashboardLayout, target: AddCardTarget): boolean {
  if (target.kind === "column") {
    const column = layout.columns.find((c) => c.id === target.columnId);
    return !!column && column.slots.length < MAX_SLOTS_PER_COLUMN;
  }
  const slot = layout.columns.flatMap((c) => c.slots).find((s) => s.id === target.slotId);
  return !!slot && slot.cards.length < MAX_CARDS_PER_SLOT;
}

function uniqueSlotId(layout: DashboardLayout, cardId: DashboardCardId): string {
  const taken = new Set(layout.columns.flatMap((column) => column.slots.map((slot) => slot.id)));
  let id = `slot-${cardId}`;
  for (let n = 2; taken.has(id); n++) id = `slot-${cardId}-${n}`;
  return id;
}

/**
 * Puts a removed card back, either as its own card at the bottom of a column or as a tab on an
 * existing card. The new tab is the one shown, so the user sees what they just added.
 */
export function addCard(layout: DashboardLayout, cardId: DashboardCardId, target: AddCardTarget): DashboardLayout {
  if (!hiddenCards(layout).includes(cardId) || !canAddCardTo(layout, target)) return layout;
  const hidden = hiddenCards(layout).filter((id) => id !== cardId);

  if (target.kind === "column") {
    const slot: DashboardSlot = { id: uniqueSlotId(layout, cardId), cards: [cardId], activeIndex: 0 };
    const columns = layout.columns.map((column) =>
      column.id === target.columnId ? { ...column, slots: [...column.slots, slot] } : column,
    );
    return withHidden({ ...layout, columns }, hidden);
  }

  const columns = layout.columns.map((column) => ({
    ...column,
    slots: column.slots.map((slot) =>
      slot.id === target.slotId
        ? { ...slot, cards: [...slot.cards, cardId], activeIndex: slot.cards.length }
        : slot,
    ),
  }));
  return withHidden({ ...layout, columns }, hidden);
}

/** Removed cards in registry order, which is the order the Add card menu lists them in. */
export function removedCardsInOrder(layout: DashboardLayout): DashboardCardId[] {
  const hidden = new Set(hiddenCards(layout));
  return CARD_IDS.filter((id) => hidden.has(id));
}
