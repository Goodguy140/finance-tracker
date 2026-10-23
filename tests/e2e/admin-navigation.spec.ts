import { expect, test, type Page } from "@playwright/test";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { expectDashboardHome } from "./expect-dashboard-home";
import { hashTestPassword, signInWithPassword, uniqueStamp } from "./helpers";

const PASSWORD = "e2e-password-123";

async function createUser(email: string, role: "USER" | "SERVER_ADMIN") {
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword(PASSWORD),
      displayName: role === "SERVER_ADMIN" ? "E2E Nav Admin" : "E2E Nav Member",
      countryCode: "CA",
      timezone: "America/Toronto",
      role,
    },
  });
  await ensureDefaultDataForUser(user);
  return user;
}

async function signIn(page: Page, email: string) {
  await signInWithPassword(page, email, PASSWORD);
  await expectDashboardHome(page);
}

const SECTIONS = [
  { path: "/settings/admin", link: "Overview" },
  { path: "/settings/admin/analytics", link: "Analytics" },
  { path: "/settings/admin/users", link: "Users" },
  { path: "/settings/admin/authentication", link: "Authentication" },
  { path: "/settings/admin/integrations", link: "Integrations" },
  { path: "/settings/admin/operations", link: "Operations" },
  { path: "/settings/admin/audit", link: "Audit log" },
  { path: "/settings/admin/system", link: "System" },
];

test("every admin section renders under the shared nav, and the nav marks where you are", async ({ page }) => {
  const email = `admin-nav-${uniqueStamp()}@example.com`;
  await createUser(email, "SERVER_ADMIN");
  await signIn(page, email);

  const nav = page.getByRole("navigation", { name: "Admin sections" });
  for (const section of SECTIONS) {
    await page.goto(section.path);
    // The page's own title, not the nav link of the same name.
    await expect(page.getByRole("heading", { level: 2, name: section.link })).toBeVisible();
    await expect(nav.getByRole("link", { name: section.link, exact: true })).toHaveAttribute("aria-current", "page");
  }

  // Client-side navigation through the nav itself.
  await nav.getByRole("link", { name: "Analytics", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/admin\/analytics$/);
  await expect(page.getByRole("heading", { level: 2, name: "Analytics" })).toBeVisible();
  await page.getByRole("group", { name: "Date range" }).getByRole("link", { name: "7d" }).click();
  await expect(page).toHaveURL(/range=7$/);
});

test("a member cannot open any admin section", async ({ page }) => {
  const email = `admin-nav-member-${uniqueStamp()}@example.com`;
  await createUser(email, "USER");
  await signIn(page, email);

  for (const path of ["/settings/admin", "/settings/admin/analytics", "/settings/admin/operations"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole("navigation", { name: "Admin sections" })).toHaveCount(0);
  }
});
