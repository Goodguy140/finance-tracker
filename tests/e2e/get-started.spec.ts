import { expect, test } from "@playwright/test";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { expectDashboardHome } from "./expect-dashboard-home";
import { hashTestPassword, signInWithPassword, uniqueStamp } from "./helpers";

test("a new user gets a checklist that ticks off and can be hidden for good", async ({ page }) => {
  const stamp = uniqueStamp();
  const email = `e2e-get-started-${stamp}@example.com`;
  const password = "e2e-password-123";
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword(password),
      displayName: "E2E New User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);

  await signInWithPassword(page, email, password);
  await expectDashboardHome(page);
  const card = page.getByTestId("get-started");
  await expect(card).toBeVisible();
  await expect(card.getByTestId("get-started-budget")).toHaveAttribute("data-done", "false");
  await expect(card.getByTestId("get-started-transactions")).toHaveAttribute("data-done", "false");

  // Logging something ticks its step off on the next load.
  const category = await prisma.category.findFirstOrThrow({ where: { userId: user.id, kind: "EXPENSE" } });
  await prisma.transaction.create({
    data: { userId: user.id, categoryId: category.id, type: "EXPENSE", amountCents: 500, date: new Date(), title: "Coffee" },
  });
  await page.reload();
  await expect(card.getByTestId("get-started-transactions")).toHaveAttribute("data-done", "true");
  await expect(card).toContainText(/1 of \d done/);

  await card.getByRole("button", { name: "Hide" }).click();
  await expect(card).toBeHidden();
  await expect
    .poll(async () => (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).getStartedDismissedAt)
    .not.toBeNull();
  await page.reload();
  await expectDashboardHome(page);
  await expect(page.getByTestId("get-started")).toHaveCount(0);
});
