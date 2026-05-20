import { expect, type Page } from "@playwright/test";

/** Dashboard root; period bootstrap may add `?month=YYYY-MM`. */
export async function expectDashboardHome(page: Page) {
  await expect(page).toHaveURL((url) => {
    const parsed = new URL(url);
    if (parsed.pathname !== "/") return false;
    const month = parsed.searchParams.get("month");
    return month === null || /^\d{4}-\d{2}$/.test(month);
  });
}
