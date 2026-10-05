import { z } from "zod";

/**
 * Bumped whenever the shape below changes incompatibly. A blob carrying an older version
 * is run through `LAYOUT_MIGRATIONS` (see ./normalize.ts); one carrying a newer version
 * fails the parse and falls back to the default, which is the safe direction — an older
 * release should not try to interpret a format it does not know.
 */
export const DASHBOARD_LAYOUT_VERSION = 1;

export const CARD_IDS = [
  "budgets",
  "spending-by-category",
  "cumulative-spend",
  "add-expense",
  "expense-log",
  "income",
  "recurring",
  "insights",
  "bills-forecast",
  "investments",
] as const;

export type DashboardCardId = (typeof CARD_IDS)[number];

const cardIdSchema = z.enum(CARD_IDS);

/**
 * Column widths are integer units on a 24-unit grid rather than percentages or floats:
 * 24 divides evenly by 2, 3 and 4, it expresses the previous fixed 7/5 split exactly as
 * 14/10, and integers cannot accumulate rounding drift across save cycles the way a
 * float would.
 */
export const TOTAL_COLUMN_UNITS = 24;
export const MIN_COLUMN_UNITS = 4;
export const MAX_COLUMNS = 4;
/** Below this a column cannot hold any of these cards legibly; enforced while dragging. */
export const MIN_COLUMN_PX = 320;
export const MAX_SLOTS_PER_COLUMN = 12;
export const MAX_CARDS_PER_SLOT = 8;
/** Bounds what the save action will accept, so a hostile client cannot store a megabyte. */
export const MAX_LAYOUT_JSON_BYTES = 16_384;

const chartHeightSchema = z.enum(["compact", "default", "tall"]).catch("default");
const listHeightSchema = z.enum(["short", "default", "tall", "unbounded"]).catch("default");
const densitySchema = z.enum(["expanded", "compact"]).catch("expanded");

/**
 * Per-card settings. Every key is optional and every value `.catch()`-guarded, so one
 * corrupt value degrades to its default instead of discarding that card's settings — or,
 * worse, failing the whole layout parse and resetting the user's arrangement.
 */
const cardSettingsSchema = z
  .object({
    "add-expense": z
      .object({
        showPostedDate: z.boolean().catch(false),
        showNote: z.boolean().catch(false),
        showReceiptBreakdown: z.boolean().catch(false),
      })
      .partial()
      .catch({}),
    budgets: z
      .object({
        perRow: z.union([z.literal(1), z.literal(2), z.literal(3)]).catch(1),
        hideZeroSpend: z.boolean().catch(false),
        showPeriodNote: z.boolean().catch(true),
      })
      .partial()
      .catch({}),
    "spending-by-category": z
      .object({
        chartHeight: chartHeightSchema,
        maxSlices: z.union([z.literal(5), z.literal(8), z.literal(12)]).catch(8),
      })
      .partial()
      .catch({}),
    "cumulative-spend": z
      .object({
        chartHeight: chartHeightSchema,
        showExpectedLine: z.boolean().catch(true),
      })
      .partial()
      .catch({}),
    "expense-log": z
      .object({
        density: densitySchema,
        maxHeight: listHeightSchema,
        showReviewQueue: z.boolean().catch(true),
      })
      .partial()
      .catch({}),
    income: z
      .object({
        density: densitySchema,
        maxHeight: listHeightSchema,
      })
      .partial()
      .catch({}),
    recurring: z
      .object({
        showCashFlowSummary: z.boolean().catch(true),
        rowLimit: z.number().int().min(3).max(50).catch(12),
      })
      .partial()
      .catch({}),
    insights: z
      .object({
        maxItems: z.union([z.literal(3), z.literal(5), z.literal(8)]).catch(3),
      })
      .partial()
      .catch({}),
    "bills-forecast": z
      .object({
        days: z.union([z.literal(30), z.literal(60), z.literal(90)]).catch(30),
      })
      .partial()
      .catch({}),
    investments: z
      .object({
        showRoom: z.boolean().catch(true),
        showForms: z.boolean().catch(true),
        showActivity: z.boolean().catch(true),
      })
      .partial()
      .catch({}),
  })
  .partial()
  .catch({});

export type DashboardCardSettings = z.infer<typeof cardSettingsSchema>;
export type ChartHeight = z.infer<typeof chartHeightSchema>;
export type ListHeight = z.infer<typeof listHeightSchema>;
export type CardDensity = z.infer<typeof densitySchema>;

/**
 * One slot is one visual card position. `cards.length > 1` makes it a tabbed stack —
 * which is why the slot, not the card, is the unit that drag-and-drop moves.
 */
const slotSchema = z.object({
  id: z.string().min(1).max(64),
  cards: z.array(cardIdSchema).min(1).max(MAX_CARDS_PER_SLOT),
  activeIndex: z.number().int().min(0).catch(0),
});

const columnSchema = z.object({
  id: z.string().min(1).max(64),
  weight: z.number().int().min(MIN_COLUMN_UNITS).max(TOTAL_COLUMN_UNITS),
  slots: z.array(slotSchema).max(MAX_SLOTS_PER_COLUMN),
});

/**
 * Cards the user took off the dashboard. Without this the reconciler could not tell a card the
 * user removed from one a new release added, and would put every removed card straight back.
 *
 * Optional rather than a version bump: a blob without it simply has nothing removed, and an
 * older release reading a newer blob drops the key and shows every card, which is the safe
 * direction. Ids are read as strings and filtered by the reconciler, so one unknown id (a card
 * a later release retired) cannot fail the parse and reset the user's arrangement.
 */
const hiddenSchema = z.array(z.string().max(64)).max(32).optional().catch(undefined);

export const dashboardLayoutSchema = z.object({
  version: z.literal(DASHBOARD_LAYOUT_VERSION),
  columns: z.array(columnSchema).min(1).max(MAX_COLUMNS),
  hidden: hiddenSchema,
  settings: cardSettingsSchema,
});

export type DashboardLayout = z.infer<typeof dashboardLayoutSchema>;
export type DashboardColumn = z.infer<typeof columnSchema>;
export type DashboardSlot = z.infer<typeof slotSchema>;

export function isDashboardCardId(value: unknown): value is DashboardCardId {
  return typeof value === "string" && (CARD_IDS as readonly string[]).includes(value);
}
