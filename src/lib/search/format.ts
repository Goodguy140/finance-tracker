import { formatCurrency } from "@/lib/money";
import type { SearchHit } from "@/lib/search/search-data";

/**
 * The amount beside a search result, signed the way the logs show it: an expense as money
 * out, a refund (a negative expense) and income as money in, a transfer unsigned.
 */
export function formatHitAmount(hit: Pick<SearchHit, "amountCents" | "currency" | "type">): string | null {
  if (hit.amountCents === undefined) return null;
  const amount = formatCurrency(Math.abs(hit.amountCents), hit.currency);
  if (hit.type === "EXPENSE") return hit.amountCents >= 0 ? `−${amount}` : `+${amount}`;
  if (hit.type === "INCOME") return hit.amountCents >= 0 ? `+${amount}` : `−${amount}`;
  return amount;
}
