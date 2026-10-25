import { expect, type Page } from "@playwright/test";

/**
 * Dashboard root, after the period bootstrap. On a bare `/` (or a month / YTD range) the
 * period filter pushes `?month=YYYY-MM` once it hydrates, which renders the page again. A spec
 * that went on before that landed could click a row and have the navigation discard the
 * dialog it opened (in-page-confirms, tags), so this waits for the month to be in the URL.
 * Lifetime and custom ranges carry no month and are left alone.
 */
export async function expectDashboardHome(page: Page) {
  await expect(page).toHaveURL((url) => {
    const parsed = new URL(url);
    if (parsed.pathname !== "/") return false;
    const range = parsed.searchParams.get("range");
    if (range === "lifetime" || range === "custom") return true;
    const month = parsed.searchParams.get("month");
    return month === "all" || (month !== null && /^\d{4}-\d{2}$/.test(month));
  });
}
