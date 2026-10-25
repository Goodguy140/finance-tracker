import { expect, test } from "@playwright/test";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { dateFromYmd } from "../../src/lib/date-only";
import { shiftYm } from "../../src/lib/dashboard-period";
import { currentYmInTimeZone } from "../../src/lib/period-month";
import { expectDashboardHome } from "./expect-dashboard-home";
import { hashTestPassword, signInWithPassword, uniqueStamp } from "./helpers";

test("a trial shows its decide-by date and cancel page, and Cancel subscription turns it off", async ({ page }) => {
  const stamp = uniqueStamp().replace(/[^a-z0-9]/gi, "");
  const email = `e2e-cancel-${stamp}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword("e2e-password-123"),
      displayName: "E2E Cancel User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  const account = await prisma.account.findFirstOrThrow({ where: { userId: user.id } });
  const category = await prisma.category.findFirstOrThrow({ where: { userId: user.id, kind: "EXPENSE" } });
  // Overdue from last month, so it shows in the current month whatever today's date is.
  const currentYm = currentYmInTimeZone(user.timezone);
  const name = `StreamCo ${stamp}`;
  const rule = await prisma.recurringTransaction.create({
    data: {
      userId: user.id,
      accountId: account.id,
      categoryId: category.id,
      type: "EXPENSE",
      name,
      amountCents: 1_000,
      cadence: "MONTHLY",
      nextExpectedDate: dateFromYmd(`${shiftYm(currentYm, -1)}-10`),
      decideBy: dateFromYmd(`${shiftYm(currentYm, 1)}-05`),
      cancelUrl: "https://streamco.example/cancel",
    },
  });

  await signInWithPassword(page, email, "e2e-password-123");
  await expectDashboardHome(page);
  const recurringPanel = page.getByRole("region", { name: "Recurring transactions" });
  await expect(recurringPanel.getByText(name, { exact: true })).toBeVisible({ timeout: 15_000 });
  const info = recurringPanel.getByTestId("subscription-cancel-info");
  await expect(info).toContainText("Decide by");
  await expect(info.getByRole("link", { name: "Cancel page" })).toHaveAttribute("href", "https://streamco.example/cancel");

  await recurringPanel.getByRole("button", { name: `More actions for ${name}` }).click();
  await recurringPanel.getByRole("button", { name: "Cancel subscription" }).click();
  await recurringPanel.getByRole("group", { name: `Cancel ${name}?` }).getByRole("button", { name: "Mark cancelled" }).click();

  await expect
    .poll(async () => {
      const row = await prisma.recurringTransaction.findUniqueOrThrow({ where: { id: rule.id } });
      return { enabled: row.enabled, cancelled: row.cancelledAt !== null };
    })
    .toEqual({ enabled: false, cancelled: true });
});
