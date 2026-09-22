import type { CardDensity, ListHeight } from "./schema";

/**
 * Scroll-area caps for the log cards. Previously hardcoded per card; now a setting, because
 * how much vertical space a log should claim depends on where the user put it — a log in a
 * narrow side column wants a different cap from one filling the main column.
 */
export const LIST_MAX_HEIGHT_CLASS: Record<ListHeight, string> = {
  short: "max-h-[min(40vh,20rem)]",
  default: "max-h-[min(70vh,36rem)]",
  tall: "max-h-[min(85vh,52rem)]",
  unbounded: "",
};

/** The income log has always been the shorter of the two; keep that relationship. */
export const COMPACT_LIST_MAX_HEIGHT_CLASS: Record<ListHeight, string> = {
  short: "max-h-[min(32vh,16rem)]",
  default: "max-h-[min(56vh,28rem)]",
  tall: "max-h-[min(80vh,44rem)]",
  unbounded: "",
};

/**
 * Where the per-device density preference used to live. Read once on first mount so nobody's
 * browser appears to reset when the setting moves to the account; never written again.
 */
export const LEGACY_DENSITY_KEYS = {
  "expense-log": "finance-tracker-expense-log-density",
  income: "finance-tracker-income-log-density",
} as const;

export function readLegacyDensity(key: string): CardDensity | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(key);
    return value === "compact" || value === "expanded" ? value : null;
  } catch {
    // Private mode, or storage blocked entirely.
    return null;
  }
}
