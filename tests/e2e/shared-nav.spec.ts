import { expect, test } from "@playwright/test";
import { expectDashboardHome } from "./expect-dashboard-home";
import { loginWithPassword, seedUser } from "./mfa-helpers";

const PAGES = [
  { path: "/", current: "Dashboard" },
  { path: "/insights", current: "Insights" },
  { path: "/reports", current: "Reports" },
  { path: "/settings/categories", current: "Settings" },
];

test("every page carries the same nav, with the current page marked", async ({ page }) => {
  const { email, password } = await seedUser("e2e-nav");
  await loginWithPassword(page, email, password);
  await expectDashboardHome(page);

  for (const { path, current } of PAGES) {
    await page.goto(path);
    // One of the two renderings is shown: the top bar on desktop, the tab bar on phones.
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav).toHaveCount(1);
    for (const label of ["Dashboard", "Insights", "Reports", "Settings"]) {
      const link = nav.getByRole("link", { name: label, exact: true });
      if (label === current) await expect(link).toHaveAttribute("aria-current", "page");
      else await expect(link).not.toHaveAttribute("aria-current", "page");
    }
    await expect(page.getByRole("link", { name: "Back to dashboard" })).toHaveCount(0);
  }
});

test("phone tab bar sits below the quick-add buttons, not over them", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "The tab bar is only rendered below the lg breakpoint");
  const { email, password } = await seedUser("e2e-nav-mobile");
  await loginWithPassword(page, email, password);
  await expectDashboardHome(page);

  const bar = await page.getByRole("navigation", { name: "Main" }).boundingBox();
  const quickAdd = await page.getByRole("button", { name: "Quick add expense" }).boundingBox();
  expect(bar).not.toBeNull();
  expect(quickAdd).not.toBeNull();
  expect(quickAdd!.y + quickAdd!.height).toBeLessThanOrEqual(bar!.y);
  expect(bar!.y + bar!.height).toBeCloseTo(page.viewportSize()!.height, 0);
});

test("the account menu holds Profile and Log out", async ({ page }) => {
  const { email, password } = await seedUser("e2e-nav-menu");
  await loginWithPassword(page, email, password);
  await expectDashboardHome(page);

  await page.getByRole("button", { name: "Account menu" }).click();
  const menu = page.getByRole("menu", { name: "Account" });
  await expect(menu).toContainText("E2E MFA User");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  await page.getByRole("button", { name: "Account menu" }).click();
  await menu.getByRole("menuitem", { name: "Profile" }).click();
  await expect(page).toHaveURL(/\/settings\/profile$/);
  await expect(menu).toHaveCount(0);
});
