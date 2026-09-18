import { expect, test, type Browser } from "@playwright/test";
import { hash } from "bcryptjs";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { expectDashboardHome } from "./expect-dashboard-home";

const PASSWORD = "e2e-password-123";

async function createUser(email: string, role: "USER" | "SERVER_ADMIN") {
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hash(PASSWORD, 12),
      displayName: role === "SERVER_ADMIN" ? "E2E Admin" : "E2E Member",
      countryCode: "CA",
      timezone: "America/Toronto",
      role,
    },
  });
  await ensureDefaultDataForUser(user);
  return user;
}

/** Signs in through the real form in its own context, so two sessions can coexist. */
async function signIn(browser: Browser, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Login" }).click();
  await expectDashboardHome(page);
  return { context, page };
}

test("an admin suspending a user ends that user's live session", async ({ browser }) => {
  const stamp = Date.now();
  const adminEmail = `e2e-admin-${stamp}@example.com`;
  const memberEmail = `e2e-member-${stamp}@example.com`;
  await createUser(adminEmail, "SERVER_ADMIN");
  await createUser(memberEmail, "USER");

  const member = await signIn(browser, memberEmail);
  const admin = await signIn(browser, adminEmail);

  await admin.page.goto("/settings/admin/users");
  const memberRow = admin.page.getByRole("row", { name: new RegExp(memberEmail) });
  await expect(memberRow).toBeVisible();
  await memberRow.getByRole("button", { name: "Suspend" }).click();
  await expect(memberRow.getByText("suspended")).toBeVisible();

  // The member's cookie is still in their browser; the next request is what must reject it.
  await member.page.goto("/");
  await expect(member.page).toHaveURL(/\/login/);
  await expect(member.page.getByPlaceholder("Email")).toBeVisible();

  // And they cannot sign back in.
  await member.page.getByPlaceholder("Email").fill(memberEmail);
  await member.page.getByPlaceholder("Password").fill(PASSWORD);
  await member.page.getByRole("button", { name: "Login" }).click();
  await expect(member.page.getByText("Invalid email or password.")).toBeVisible();

  await expect(memberRow.getByRole("button", { name: "Restore" })).toBeVisible();
  await memberRow.getByRole("button", { name: "Restore" }).click();
  await expect(memberRow.getByText("active")).toBeVisible();

  await member.context.close();
  await admin.context.close();
});

test("an admin cannot remove the last admin who can sign in", async ({ browser }) => {
  const stamp = Date.now();
  const adminEmail = `e2e-solo-admin-${stamp}@example.com`;
  await createUser(adminEmail, "SERVER_ADMIN");

  const admin = await signIn(browser, adminEmail);
  await admin.page.goto("/settings/admin/users");

  // Own-account controls are absent entirely, which is the guard rail's first layer.
  const ownRow = admin.page.getByRole("row", { name: new RegExp(adminEmail) });
  await expect(ownRow).toBeVisible();
  await expect(ownRow.getByRole("button", { name: "Suspend" })).toHaveCount(0);
  await expect(ownRow.getByText("(you)")).toBeVisible();

  await admin.context.close();
});
