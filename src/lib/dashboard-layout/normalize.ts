import { DASHBOARD_CARDS, DEFAULT_LAYOUT } from "./cards";
import { enforceMinimums } from "./columns";
import {
  CARD_IDS,
  type DashboardCardId,
  type DashboardColumn,
  type DashboardLayout,
  DASHBOARD_LAYOUT_VERSION,
  dashboardLayoutSchema,
  isDashboardCardId,
  MAX_CARDS_PER_SLOT,
  MAX_COLUMNS,
  MAX_SLOTS_PER_COLUMN,
} from "./schema";

/**
 * One entry per historical version, each turning a blob of version `i` into one of version
 * `i + 1`. Empty while only version 1 has shipped; adding a version means appending here
 * rather than widening the schema with optional fields forever.
 */
const LAYOUT_MIGRATIONS: Array<(blob: Record<string, unknown>) => Record<string, unknown>> = [];

export type ReconciledLayout = {
  /**
   * What to persist. Keeps cards that exist in this release but are not renderable right
   * now — the Income card in a period with no income is hidden, not removed.
   */
  stored: DashboardLayout;
  /** What to render: `stored` filtered down to the cards the page actually produced. */
  rendered: DashboardLayout;
  /** True when `stored` differs from the input, so the caller may write it back. */
  changed: boolean;
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function parseBlob(rawJson: string | null): Record<string, unknown> | null {
  if (!rawJson) return null;
  try {
    const parsed: unknown = JSON.parse(rawJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function upgrade(blob: Record<string, unknown>): Record<string, unknown> | null {
  const version = blob.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) return null;
  // A blob from a newer release: fall back to the default rather than guess at its shape.
  if (version > DASHBOARD_LAYOUT_VERSION) return null;

  let current = blob;
  for (let v = version; v < DASHBOARD_LAYOUT_VERSION; v++) {
    const migrate = LAYOUT_MIGRATIONS[v - 1];
    if (!migrate) return null;
    current = migrate(current);
  }
  return current;
}

/**
 * Turn whatever is in the database into a layout this release can render, without ever
 * throwing and without ever losing a card. Unknown ids are dropped, duplicates collapse to
 * their first occurrence, and cards that did not exist when the blob was written are
 * appended at their registry position — so a release that adds or removes a card needs no
 * data migration.
 */
export function reconcileDashboardLayout(
  rawJson: string | null,
  available: readonly DashboardCardId[],
): ReconciledLayout {
  const raw = parseBlob(rawJson);
  const upgraded = raw ? upgrade(raw) : null;
  const parsed = upgraded ? dashboardLayoutSchema.safeParse(upgraded) : null;

  if (!parsed?.success) {
    const fallback = clone(DEFAULT_LAYOUT);
    return {
      stored: fallback,
      rendered: filterToAvailable(fallback, available),
      // A blob we could not use is not a change the user made; only flag a write-back when
      // there was something there to replace.
      changed: rawJson !== null,
    };
  }

  const input = parsed.data;
  let changed = false;

  const seen = new Set<DashboardCardId>();
  const columns: DashboardColumn[] = [];

  for (const column of input.columns.slice(0, MAX_COLUMNS)) {
    const slots = [];
    for (const slot of column.slots.slice(0, MAX_SLOTS_PER_COLUMN)) {
      const cards: DashboardCardId[] = [];
      for (const card of slot.cards) {
        // Unknown id (a card this release removed), or one already placed elsewhere.
        if (!isDashboardCardId(card) || seen.has(card)) {
          changed = true;
          continue;
        }
        seen.add(card);
        cards.push(card);
        if (cards.length >= MAX_CARDS_PER_SLOT) break;
      }
      if (cards.length === 0) {
        changed = true;
        continue;
      }
      const activeIndex = Math.min(Math.max(slot.activeIndex, 0), cards.length - 1);
      if (activeIndex !== slot.activeIndex) changed = true;
      slots.push({ id: slot.id, cards, activeIndex });
    }
    columns.push({ id: column.id, weight: column.weight, slots });
  }

  // Cards this release added since the blob was written land at their registry position.
  for (const cardId of CARD_IDS) {
    if (seen.has(cardId)) continue;
    changed = true;
    const meta = DASHBOARD_CARDS[cardId];
    const columnIndex = Math.min(Math.max(meta.defaultColumnIndex, 0), columns.length - 1);
    const target = columns[columnIndex] ?? columns[0];
    const slotIndex = Math.min(Math.max(meta.defaultSlotIndex, 0), target.slots.length);
    target.slots.splice(slotIndex, 0, {
      id: `slot-${cardId}`,
      cards: [cardId],
      activeIndex: 0,
    });
  }

  const nonEmpty = columns.filter((column) => column.slots.length > 0);
  if (nonEmpty.length !== columns.length) changed = true;
  if (nonEmpty.length === 0) {
    const fallback = clone(DEFAULT_LAYOUT);
    return { stored: fallback, rendered: filterToAvailable(fallback, available), changed: true };
  }

  const weighted = enforceMinimums(nonEmpty);
  if (weighted.some((column, i) => column.weight !== nonEmpty[i].weight)) changed = true;

  const settings = dropSettingsForMissingCards(input.settings);
  if (Object.keys(settings).length !== Object.keys(input.settings).length) changed = true;

  const stored: DashboardLayout = {
    version: DASHBOARD_LAYOUT_VERSION,
    columns: weighted,
    settings,
  };

  return { stored, rendered: filterToAvailable(stored, available), changed };
}

function dropSettingsForMissingCards(settings: DashboardLayout["settings"]): DashboardLayout["settings"] {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (isDashboardCardId(key)) next[key] = value;
  }
  return next as DashboardLayout["settings"];
}

/**
 * Derive the renderable layout from the stored one. Crucially this only ever produces a
 * *copy*: a card the page did not render this time — Income in a month with no income — is
 * absent here but untouched in `stored`. Filtering the stored layout instead would delete
 * the user's card permanently the first time they viewed an empty month.
 */
export function filterToAvailable(
  layout: DashboardLayout,
  available: readonly DashboardCardId[],
  options: {
    /**
     * Keep columns that end up with no cards. Normal viewing collapses them so an empty
     * column is not dead space, but while editing they have to stay: a column just added,
     * or one whose last card was dragged away, is the target you are about to drop onto.
     */
    keepEmptyColumns?: boolean;
  } = {},
): DashboardLayout {
  const allowed = new Set(available);
  const columns = layout.columns
    .map((column) => ({
      ...column,
      slots: column.slots
        .map((slot) => {
          const cards = slot.cards.filter((card) => allowed.has(card));
          return {
            ...slot,
            cards,
            activeIndex: Math.min(Math.max(slot.activeIndex, 0), Math.max(cards.length - 1, 0)),
          };
        })
        .filter((slot) => slot.cards.length > 0),
    }))
    .filter((column) => options.keepEmptyColumns || column.slots.length > 0);

  if (columns.length === 0) {
    return { version: layout.version, columns: [{ id: "col-empty", weight: 24, slots: [] }], settings: layout.settings };
  }

  return { version: layout.version, columns: enforceMinimums(columns), settings: layout.settings };
}
