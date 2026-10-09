/**
 * How much of the bank review queue the dashboard renders at once.
 *
 * Every row carries rule proposals for both ways it can be booked, so a first sync of a busy
 * account can leave more than is worth building on one page load. The queue shows a page of
 * rows, says how many there are in all, and grows a page at a time through `?queue=`. It used
 * to stop at 200 without saying so, which left everything older out of reach.
 */
export const REVIEW_QUEUE_PAGE_SIZE = 200;

/** The `?queue=` value, as a row limit: a whole number of pages, never fewer than one. */
export function parseReviewQueueLimit(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const n = value ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(n) || n <= REVIEW_QUEUE_PAGE_SIZE) return REVIEW_QUEUE_PAGE_SIZE;
  return Math.ceil(n / REVIEW_QUEUE_PAGE_SIZE) * REVIEW_QUEUE_PAGE_SIZE;
}

/** The limit that shows the next page, or null when every row is already on screen. */
export function nextReviewQueueLimit(shown: number, total: number): number | null {
  if (shown >= total) return null;
  return Math.ceil((shown + 1) / REVIEW_QUEUE_PAGE_SIZE) * REVIEW_QUEUE_PAGE_SIZE;
}
