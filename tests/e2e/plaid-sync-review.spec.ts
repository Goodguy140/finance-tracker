import { expect, test, type Page } from "@playwright/test";
import { hash } from "bcryptjs";
import { prisma } from "../../src/lib/prisma";
import { currentYmInTimeZone } from "../../src/lib/period-month";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { configurePlaidForTests } from "./plaid-helpers";
import { expectDashboardHome } from "./expect-dashboard-home";
import { uniqueStamp } from "./helpers";
import { addVirtualAuthenticator, enrolFirstPasskey, openSettingsTab } from "./mfa-helpers";

const PASSWORD = "e2e-password-123";

function daysAgoUtc(days: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Login" }).click();
}

test("syncing stages transactions for review, links exact matches, and only a reviewed row reaches the log", async ({ page }) => {
  await addVirtualAuthenticator(page);
  const stamp = uniqueStamp();
  const email = `plaid-sync-${stamp}@example.com`;
  await configurePlaidForTests();

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hash(PASSWORD, 12),
      displayName: "E2E Sync User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);

  const account = await prisma.account.findFirstOrThrow({
    where: { userId: user.id, archived: false, currency: "CAD" },
  });
  const diningCategory = await prisma.category.findFirstOrThrow({
    where: { userId: user.id, kind: "EXPENSE" },
  });

  // A category renamed away from what Plaid's map looks for, with a budget still carrying
  // the old label. The suggestion has to follow the budget's label to find it, so this is
  // what proves budget labels reach the planner at all.
  const leisure = await prisma.category.update({
    where: { userId_name_kind: { userId: user.id, name: "Fun", kind: "EXPENSE" } },
    data: { name: "Leisure" },
  });
  await prisma.budget.create({
    data: {
      userId: user.id,
      categoryId: leisure.id,
      name: "Fun",
      periodMonth: currentYmInTimeZone(user.timezone),
      limitCents: 20000,
    },
  });

  // A transaction the user entered by hand that the bank will also report, to the cent —
  // the sync should link this one itself rather than queue it.
  const manual = await prisma.transaction.create({
    data: {
      userId: user.id,
      accountId: account.id,
      categoryId: diningCategory.id,
      type: "EXPENSE",
      amountCents: 1200,
      date: daysAgoUtc(2),
      title: "Blue Bottle Coffee",
    },
  });

  // One the bank reports $1.50 higher than entered. Close enough to propose, not equal, so
  // it has to wait for the user to link it.
  const manualHardware = await prisma.transaction.create({
    data: {
      userId: user.id,
      accountId: account.id,
      categoryId: diningCategory.id,
      type: "EXPENSE",
      amountCents: 3000,
      date: daysAgoUtc(4),
      title: "Maple Hardware",
    },
  });

  await signIn(page, email);
  await expectDashboardHome(page);
  await enrolFirstPasskey(page, PASSWORD);

  // --- connect and map ---
  await openSettingsTab(page, "accounts");
  const panel = page.getByRole("region", { name: "Connected banks" });
  await panel.getByLabel("How far back to fetch").selectOption("90");
  await panel.getByRole("button", { name: "Connect a bank" }).click();
  await expect(panel.getByText(/Connected to Test Credit Union/i)).toBeVisible({ timeout: 15_000 });

  const chequingSelect = page.getByLabel("Send Everyday Chequing transactions to");
  await chequingSelect.selectOption(account.id);
  await chequingSelect.locator("..").getByRole("button", { name: "Save" }).click();
  await expect
    .poll(async () => {
      const row = await prisma.plaidAccount.findFirstOrThrow({
        where: { userId: user.id, plaidAccountId: "fake-acct-chequing" },
      });
      return row.accountId;
    }, { timeout: 10_000 })
    .toBe(account.id);

  // --- sync ---
  await page.reload();
  await openSettingsTab(page, "accounts");
  await page.getByRole("region", { name: "Connected banks" }).getByRole("button", { name: "Sync now" }).click();

  // Polled on the auto-link, the last thing the sync writes. Matching runs after the whole
  // walk commits, so all rows exist unmatched for a moment first — waiting on the count
  // and then reading the match reads that gap, which is exactly how this flaked.
  await expect
    .poll(
      async () => {
        const verification = await prisma.transactionVerification.findUnique({
          where: { transactionId: manual.id },
          select: { plaidTransactionId: true },
        });
        return verification?.plaidTransactionId ?? null;
      },
      { timeout: 20_000 },
    )
    .toBe("fake-txn-coffee");

  // The exact match was linked; the other four wait for the user.
  expect(
    await prisma.plaidStagedTransaction.count({
      where: { userId: user.id, status: "NEEDS_REVIEW" },
    }),
  ).toBe(4);

  // Nothing was added to the log: the two manual rows are still the only transactions.
  expect(await prisma.transaction.count({ where: { userId: user.id } })).toBe(2);

  const staged = await prisma.plaidStagedTransaction.findMany({ where: { userId: user.id } });
  const byId = new Map(staged.map((row) => [row.plaidTransactionId, row]));

  // Sign mapping: income positive, refund a NEGATIVE expense rather than income.
  expect(byId.get("fake-txn-payroll")!.type).toBe("INCOME");
  expect(byId.get("fake-txn-payroll")!.amountCents).toBe(250000);
  expect(byId.get("fake-txn-refund")!.type).toBe("EXPENSE");
  expect(byId.get("fake-txn-refund")!.amountCents).toBe(-4590);

  // Plaid's GENERAL_MERCHANDISE reached the renamed category through its budget's label,
  // rather than falling to the catch-all.
  expect(byId.get("fake-txn-hardware")!.suggestedCategoryId).toBe(leisure.id);

  // The coffee was linked to what the user entered, and verified against the bank.
  const coffee = byId.get("fake-txn-coffee")!;
  expect(coffee.status).toBe("LINKED");
  expect(coffee.resolvedTransactionId).toBe(manual.id);
  const autoVerification = await prisma.transactionVerification.findUniqueOrThrow({
    where: { transactionId: manual.id },
  });
  expect(autoVerification.source).toBe("MATCHED");
  expect(autoVerification.institutionName).toBe("Test Credit Union");
  // The user's own values are kept.
  const coffeeAfter = await prisma.transaction.findUniqueOrThrow({ where: { id: manual.id } });
  expect(coffeeAfter.amountCents).toBe(1200);
  expect(coffeeAfter.title).toBe("Blue Bottle Coffee");

  // The hardware row was only proposed: its amount differs from what the user entered.
  const hardware = byId.get("fake-txn-hardware")!;
  expect(hardware.status).toBe("NEEDS_REVIEW");
  expect(hardware.matchTransactionId).toBe(manualHardware.id);
  expect(hardware.matchTier).toBe("low");
  expect(byId.get("fake-txn-groceries")!.matchTransactionId).toBeNull();

  // --- review on the dashboard ---
  // Lifetime: the queue follows the period on screen, and the fixtures are dated a few days
  // back, so in the first days of a month they fall in the previous one.
  await page.goto("/?range=lifetime");
  const queue = page.locator("section").filter({ hasText: "From your bank" }).first();
  await expect(queue).toBeVisible();
  await expect(queue.getByText("Loblaws")).toBeVisible();
  // The hardware row has no merchant_name, so its heading is the bank's own description
  // ("SQ *MAPLE HARDWARE #0114 OTTAWA ON") cleaned up rather than shown raw.
  await expect(queue.getByText("Maple Hardware Ottawa")).toBeVisible();
  // The auto-linked coffee is not in the queue. Matched on the row's own controls: the
  // log, which shows the coffee, sits inside the same outer section.
  await expect(page.getByRole("group", { name: "What to do with Maple Hardware Ottawa" })).toHaveCount(1);
  await expect(page.getByRole("group", { name: /^What to do with Blue Bottle/ })).toHaveCount(0);

  // The proposed link is surfaced, not applied silently.
  await expect(queue.getByText(/Looks like/i)).toBeVisible();

  // A low-tier match pre-selects "Add as new", so the user picks Link themselves.
  const hardwareCard = queue.locator("li").filter({ hasText: "Maple Hardware Ottawa" }).first();
  await hardwareCard.getByRole("button", { name: "Link", exact: true }).click();
  await hardwareCard.getByRole("button", { name: "Link it" }).click();

  await expect
    .poll(async () => prisma.transactionVerification.count({ where: { userId: user.id } }), {
      timeout: 15_000,
    })
    .toBe(2);

  const verification = await prisma.transactionVerification.findUniqueOrThrow({
    where: { transactionId: manualHardware.id },
  });
  expect(verification.source).toBe("MATCHED");
  expect(verification.institutionName).toBe("Test Credit Union");
  // Linking must not create another transaction, nor change the amount the user entered.
  expect(await prisma.transaction.count({ where: { userId: user.id } })).toBe(2);
  expect(
    (await prisma.transaction.findUniqueOrThrow({ where: { id: manualHardware.id } })).amountCents,
  ).toBe(3000);

  // --- the badge appears in the log ---
  // Lifetime, not the default current month: the fixtures are dated a few days back, so in
  // the first days of a month they fall in the previous one and the log would not show them.
  await page.goto("/?range=lifetime");
  // Both layouts are always in the DOM with one hidden by CSS, so the badge matches twice
  // and a bare .first() picks whichever comes first in source order — hidden on whichever
  // viewport is not in play. Match the visible one, as `expectExpenseInLog` does.
  await expect(
    page.getByTitle(/Matched to Test Credit Union/i).filter({ visible: true }).first(),
  ).toBeVisible({ timeout: 15_000 });

  // --- adding a new one does create a transaction, with a badge of its own ---
  const groceriesCard = page
    .locator("section")
    .filter({ hasText: "From your bank" })
    .first()
    .locator("li")
    .filter({ hasText: "Loblaws" })
    .first();
  await groceriesCard.getByRole("button", { name: "Add it" }).click();

  await expect
    .poll(async () => prisma.transaction.count({ where: { userId: user.id } }), { timeout: 15_000 })
    .toBe(3);

  const added = await prisma.transaction.findFirstOrThrow({
    where: { userId: user.id, title: "Loblaws" },
    include: { verification: true },
  });
  expect(added.amountCents).toBe(8421);
  expect(added.accountId).toBe(account.id);
  expect(added.verification?.source).toBe("IMPORTED");

  // --- a second sync is a no-op: nothing is re-proposed ---
  await openSettingsTab(page, "accounts");
  await page.getByRole("region", { name: "Connected banks" }).getByRole("button", { name: "Sync now" }).click();
  await page.waitForTimeout(2_000);
  expect(
    await prisma.plaidStagedTransaction.count({
      where: { userId: user.id, status: "NEEDS_REVIEW" },
    }),
  ).toBe(2);
  expect(await prisma.transaction.count({ where: { userId: user.id } })).toBe(3);

  // --- the refresh control in the log runs that same sweep, on a shorter interval ---
  // Aged 20 minutes: past the log refresh's 15-minute floor but inside the hourly sweep
  // interval, so this click only syncs because the refresh shortens it. A refresh that
  // waited for the sweep interval would be a no-op here and fail the poll below.
  const dueBefore = new Date(Date.now() - 20 * 60 * 1000);
  await prisma.plaidItem.updateMany({
    where: { userId: user.id },
    data: { lastSyncedAt: dueBefore },
  });
  const syncAuditsBefore = await prisma.auditLog.count({
    where: { userId: user.id, action: "plaid_item_sync_succeeded" },
  });

  // Lifetime for the same reason: the log, which holds this control, is empty otherwise.
  await page.goto("/?range=lifetime");
  await page.getByRole("button", { name: "Refresh linked accounts" }).click();

  // The audit row is the last thing the action writes — the sweep commits first — so
  // waiting on it cannot read the gap between the sync and the record of it.
  await expect
    .poll(
      async () =>
        prisma.auditLog.count({
          where: { userId: user.id, action: "plaid_item_sync_succeeded" },
        }),
      { timeout: 20_000 },
    )
    .toBe(syncAuditsBefore + 1);

  // The control says what came of it; the sync above already took everything there was.
  await expect(page.getByRole("status").filter({ hasText: "No new transactions." })).toBeVisible();

  const refreshed = await prisma.plaidItem.findFirstOrThrow({ where: { userId: user.id } });
  expect(refreshed.lastSyncedAt!.getTime()).toBeGreaterThan(dueBefore.getTime());
  // Still nothing posted behind the user's back.
  expect(await prisma.transaction.count({ where: { userId: user.id } })).toBe(3);
});
