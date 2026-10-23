import { expect, test, type Page } from "@playwright/test";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { PRIVATE_PAGES_CACHE } from "../../src/lib/pwa-cache";
import { expectDashboardHome } from "./expect-dashboard-home";
import { addExpenseOnDashboard, expectExpenseInLog, expenseLogLocator, hashTestPassword, signInWithPassword, uniqueStamp } from "./helpers";

test("PWA files are served to a signed-out device", async ({ request }) => {
  // No redirects followed: a bounce to /login is exactly the failure being guarded.
  for (const path of ["/manifest.webmanifest", "/sw.js", "/icons/icon-192.png", "/icons/maskable-512.png", "/apple-icon.png", "/offline"]) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status(), path).toBe(200);
  }

  const manifest = await (await request.get("/manifest.webmanifest", { maxRedirects: 0 })).json();
  expect(manifest.display).toBe("standalone");

  const sw = await request.get("/sw.js", { maxRedirects: 0 });
  expect(sw.headers()["cache-control"]).toContain("no-cache");
  expect(sw.headers()["content-type"]).toContain("javascript");
});

async function signInFreshUser(page: Page) {
  const stamp = uniqueStamp();
  const email = `e2e-pwa-${stamp}@example.com`;
  const password = "e2e-password-123";
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword(password),
      displayName: "E2E PWA User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);

  await signInWithPassword(page, email, password);
  await expectDashboardHome(page);
  return { stamp, userId: user.id };
}

/** Whether the service worker's copy of the most recent dashboard contains `text`. */
function cachedDashboardContains(page: Page, text: string) {
  return page.evaluate(
    async ({ cacheName, needle }) => {
      const cache = await caches.open(cacheName);
      const hit = await cache.match("/__last-dashboard");
      return hit ? (await hit.text()).includes(needle) : false;
    },
    { cacheName: PRIVATE_PAGES_CACHE, needle: text },
  );
}

test("offline: last dashboard stays readable, writes are refused, sign-out drops it", async ({ page, context }, testInfo) => {
  const { stamp, userId } = await signInFreshUser(page);

  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  const title = `PWA cached ${stamp}`;
  await addExpenseOnDashboard(page, testInfo.project.name, title, "4.20");

  // A full load through the worker is what gets cached. It writes the exact URL and then
  // the "last dashboard" entry; wait on the last one, and on its content, not its presence.
  await page.reload();
  await expect.poll(() => cachedDashboardContains(page, title)).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expectExpenseInLog(page, title);
  await expect(page.getByTestId("offline-banner")).toContainText("changes are disabled");

  // Writing is refused rather than queued for later.
  const offlineTitle = `PWA offline write ${stamp}`;
  if (testInfo.project.name === "mobile-chromium") {
    await expect(page.getByRole("button", { name: "Quick add expense" })).toBeDisabled();
  } else {
    const section = page.getByRole("region", { name: "Add", exact: true });
    await section.getByPlaceholder("e.g. Weekly groceries, Shell fuel").fill(offlineTitle);
    await section.locator('input[name="amount"]').fill("9.99");
    await section.getByRole("button", { name: "Add expense", exact: true }).click();
    await expect(page.getByRole("alertdialog")).toContainText("You're offline");
  }
  await context.setOffline(false);
  // Same query finds the online write, so the zero below is not a query that matches nothing.
  expect(await prisma.transaction.count({ where: { userId, title } })).toBe(1);
  expect(await prisma.transaction.count({ where: { userId, title: offlineTitle } })).toBe(0);

  // Session ends server-side (as on expiry or revocation elsewhere): the next dashboard
  // request bounces to /login, and the cached copy must go with it.
  await context.clearCookies();
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect
    .poll(() => page.evaluate((name) => caches.has(name), PRIVATE_PAGES_CACHE))
    .toBe(false);

  await context.setOffline(true);
  await page.goto("/").catch(() => undefined);
  await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
  await expect(expenseLogLocator(page)).toHaveCount(0);
  await context.setOffline(false);
});
