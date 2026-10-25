import {
  type DashboardCardId,
  type DashboardLayout,
  type DashboardSlot,
  DASHBOARD_LAYOUT_VERSION,
} from "./schema";

export type DashboardCardMeta = {
  id: DashboardCardId;
  /** Heading text, the card region's accessible name, and the source of a stack tab label. */
  title: string;
  /** Shorter label for a stack's tab strip, where horizontal space is tight. */
  tabLabel: string;
  /**
   * Where a card that is new to this release lands in a layout saved before it existed.
   * Clamped against the saved layout's actual column count at reconcile time.
   */
  defaultColumnIndex: number;
  defaultSlotIndex: number;
  /**
   * True when the page only renders this card for some periods — the Income card is absent
   * from a month with no income. Such a card being unrenderable must never be read as the
   * user having removed it; see the `stored` / `rendered` split in ./normalize.ts.
   */
  conditional: boolean;
  /** False for cards with nothing worth configuring; suppresses the header gear. */
  hasSettings: boolean;
  /**
   * In a layout saved before this card existed, join this card's slot as a tab (not the active
   * one) instead of taking a slot of its own. For a card that would otherwise add a slot where
   * a new one would upset the column balance; falls back to the default position when that
   * card is not on the dashboard or its stack is full.
   */
  joinsSlotOf?: DashboardCardId;
};

export const DASHBOARD_CARDS: Record<DashboardCardId, DashboardCardMeta> = {
  budgets: {
    id: "budgets",
    title: "Budgets",
    tabLabel: "Budgets",
    defaultColumnIndex: 1,
    defaultSlotIndex: 0,
    conditional: false,
    hasSettings: true,
  },
  "spending-by-category": {
    id: "spending-by-category",
    title: "Spending by category",
    tabLabel: "Categories",
    defaultColumnIndex: 1,
    defaultSlotIndex: 1,
    conditional: false,
    hasSettings: true,
  },
  "cumulative-spend": {
    id: "cumulative-spend",
    title: "Cumulative spending",
    tabLabel: "Trend",
    defaultColumnIndex: 0,
    defaultSlotIndex: 0,
    conditional: false,
    hasSettings: true,
  },
  "add-expense": {
    id: "add-expense",
    // The id predates income being added here; it stays, since saved layouts refer to it.
    title: "Add",
    tabLabel: "Add",
    defaultColumnIndex: 0,
    defaultSlotIndex: 1,
    conditional: false,
    hasSettings: true,
  },
  "expense-log": {
    id: "expense-log",
    title: "Expense Log",
    tabLabel: "Expenses",
    defaultColumnIndex: 0,
    defaultSlotIndex: 2,
    conditional: false,
    hasSettings: true,
  },
  income: {
    id: "income",
    title: "Income",
    tabLabel: "Income",
    defaultColumnIndex: 1,
    defaultSlotIndex: 2,
    conditional: true,
    hasSettings: true,
  },
  recurring: {
    id: "recurring",
    title: "Recurring transactions",
    tabLabel: "Recurring",
    defaultColumnIndex: 1,
    defaultSlotIndex: 3,
    conditional: false,
    hasSettings: true,
  },
  insights: {
    id: "insights",
    title: "Insights",
    tabLabel: "Insights",
    // The main column, not the side: when a narrow window merges two columns the one with fewer
    // slots is folded into the other, and a fourth side slot would make the main column the
    // one that moves — remounting the expense log and dropping any open edit mid-flight.
    defaultColumnIndex: 0,
    defaultSlotIndex: 1,
    conditional: false,
    hasSettings: true,
  },
  "bills-forecast": {
    id: "bills-forecast",
    title: "Upcoming bills",
    tabLabel: "Upcoming",
    // Main column, under Insights. Beside Recurring in the side column (as its own slot or
    // as a tab with it) would give the side column more in it than the main one, and a
    // narrow window would then fold the main column into it — see `insights`.
    defaultColumnIndex: 0,
    defaultSlotIndex: 2,
    conditional: false,
    hasSettings: true,
  },
  investments: {
    id: "investments",
    title: "Investments",
    tabLabel: "Investments",
    // A tab on Insights rather than a slot of its own, for the column-fold reason under
    // `insights`: a new slot in either column could flip which one a narrow window folds.
    defaultColumnIndex: 0,
    defaultSlotIndex: 2,
    joinsSlotOf: "insights",
    conditional: false,
    hasSettings: true,
  },
  calendar: {
    id: "calendar",
    title: "Calendar",
    tabLabel: "Calendar",
    // A tab on Cumulative spending: the same month's spending seen day by day, and no new slot
    // to upset the column balance (see `insights`).
    defaultColumnIndex: 0,
    defaultSlotIndex: 0,
    joinsSlotOf: "cumulative-spend",
    conditional: false,
    hasSettings: true,
  },
  "safe-to-spend": {
    id: "safe-to-spend",
    title: "Safe to spend",
    tabLabel: "Safe to spend",
    // A tab beside Budgets for a layout saved before it: it reads off the same numbers, and a
    // slot of its own could flip which column a narrow window folds (see `insights`).
    defaultColumnIndex: 1,
    defaultSlotIndex: 0,
    joinsSlotOf: "budgets",
    conditional: false,
    hasSettings: true,
  },
};

/**
 * The out-of-the-box arrangement, reproducing the fixed layout this replaced: a 14/10
 * split of the 24-unit grid is exactly the old `lg:col-span-7` / `lg:col-span-5`.
 */
export const DEFAULT_LAYOUT: DashboardLayout = {
  version: DASHBOARD_LAYOUT_VERSION,
  columns: [
    {
      id: "col-main",
      weight: 14,
      slots: [
        { id: "slot-trend", cards: ["cumulative-spend", "calendar"], activeIndex: 0 },
        { id: "slot-insights", cards: ["insights", "investments"], activeIndex: 0 },
        { id: "slot-bills-forecast", cards: ["bills-forecast"], activeIndex: 0 },
        { id: "slot-add", cards: ["add-expense"], activeIndex: 0 },
        { id: "slot-log", cards: ["expense-log"], activeIndex: 0 },
      ],
    },
    {
      id: "col-side",
      weight: 10,
      slots: [
        { id: "slot-budgets", cards: ["budgets", "safe-to-spend"], activeIndex: 0 },
        { id: "slot-categories", cards: ["spending-by-category"], activeIndex: 0 },
        { id: "slot-income", cards: ["income"], activeIndex: 0 },
        { id: "slot-recurring", cards: ["recurring"], activeIndex: 0 },
      ],
    },
  ],
  settings: {},
};

/**
 * Mobile is frozen and never derived from the user's desktop layout: one column, in the
 * order the previous hand-placed `order-1..4` classes produced — the three-panel swipe
 * carousel, then the expense log, income, recurring, upcoming bills, and insights with investments as its second
 * tab. Add Expense is absent because it
 * was `hidden lg:block`; below `lg` it lives in the quick-add sheet instead.
 */
export const MOBILE_SLOTS: readonly DashboardSlot[] = [
  {
    id: "mobile-carousel",
    cards: ["spending-by-category", "budgets", "cumulative-spend"],
    activeIndex: 0,
  },
  { id: "mobile-safe-to-spend", cards: ["safe-to-spend"], activeIndex: 0 },
  { id: "mobile-log", cards: ["expense-log"], activeIndex: 0 },
  { id: "mobile-income", cards: ["income"], activeIndex: 0 },
  { id: "mobile-recurring", cards: ["recurring"], activeIndex: 0 },
  { id: "mobile-bills-forecast", cards: ["bills-forecast"], activeIndex: 0 },
  { id: "mobile-calendar", cards: ["calendar"], activeIndex: 0 },
  { id: "mobile-insights", cards: ["insights", "investments"], activeIndex: 0 },
];

export function cardTitle(id: DashboardCardId): string {
  return DASHBOARD_CARDS[id].title;
}

/** A stack's accessible name is every card it holds, so the region stays identifiable. */
export function slotAccessibleName(cards: readonly DashboardCardId[]): string {
  return cards.map(cardTitle).join(", ");
}
