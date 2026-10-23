import { expect, test } from "@playwright/test";
import { CategoryKind, PlaidStagedStatus, TransactionType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { encryptSecret } from "../../src/lib/security";
import { expectDashboardHome } from "./expect-dashboard-home";
import { hashTestPassword, signInWithPassword, uniqueStamp } from "./helpers";

/**
 * Bulk triage in the review queue: tick rows and add them in one category or ignore them, and
 * link every strong match in one go. The rows are staged directly, as a sync would leave them.
 */
async function seed(page: import("@playwright/test").Page) {
  const stamp = uniqueStamp();
  const email = `e2e-queue-bulk-${stamp}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword(),
      displayName: "E2E Queue Bulk",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  const account = await prisma.account.findFirstOrThrow({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
  const groceries = await prisma.category.findFirstOrThrow({ where: { userId: user.id, kind: CategoryKind.EXPENSE, name: "Groceries" } });
  const item = await prisma.plaidItem.create({
    data: {
      userId: user.id,
      itemId: `queue-bulk-item-${stamp}`,
      accessTokenEnc: encryptSecret(`access-sandbox-queue-bulk-${stamp}`),
      institutionName: "Test Credit Union",
      requestedDays: 90,
      historyCutoff: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
      lastSyncedAt: new Date(),
    },
  });
  const plaidAccount = await prisma.plaidAccount.create({
    data: { userId: user.id, plaidItemId: item.id, plaidAccountId: `queue-bulk-acct-${stamp}`, name: "Chequing", plaidType: "depository", accountId: account.id },
  });
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15));
  // Two entries the user already made, which two bank rows match exactly.
  const entries = await Promise.all(
    ["Hydro Ottawa", "Rogers Wireless"].map((title, i) =>
      prisma.transaction.create({
        data: { userId: user.id, accountId: account.id, categoryId: groceries.id, type: TransactionType.EXPENSE, amountCents: 8_000 + i, date, title },
      }),
    ),
  );
  const names = ["Farm stand", "Corner store", "Bakery", "Parking", "Hydro Ottawa", "Rogers Wireless"];
  const amounts = [1_100, 1_200, 1_300, 1_400, 8_000, 8_001];
  await prisma.plaidStagedTransaction.createMany({
    data: names.map((name, i) => ({
      userId: user.id,
      plaidItemId: item.id,
      plaidAccountRowId: plaidAccount.id,
      plaidTransactionId: `queue-bulk-${stamp}-${i}`,
      name,
      amountCents: amounts[i],
      type: TransactionType.EXPENSE,
      date,
      suggestedAccountId: account.id,
      // The sync's matcher stores its proposal on the row; the last two match exactly.
      ...(i >= 4 ? { matchTransactionId: entries[i - 4].id, matchScore: 95, matchTier: "high" } : {}),
    })),
  });

  await signInWithPassword(page, email);
  await expectDashboardHome(page);
  await expect(page).toHaveURL(/[?&]month=/);
  const queue = page.locator("section").filter({ hasText: "From your bank" }).first();
  const staged = (name: string) => prisma.plaidStagedTransaction.findFirstOrThrow({ where: { userId: user.id, name } });
  return { user, queue, groceries, entries, staged };
}

test("ticked rows can be added in one category, or ignored", async ({ page }) => {
  const { user, queue, groceries, staged } = await seed(page);

  await queue.getByLabel("Select Farm stand").check();
  await queue.getByLabel("Select Corner store").check();
  const bar = queue.getByTestId("review-bulk-bar");
  await expect(bar).toContainText("2 selected");
  await bar.getByLabel("Category for the selected rows").selectOption(groceries.id);
  await bar.getByRole("button", { name: "Add to category" }).click();
  await expect.poll(async () => (await staged("Corner store")).status).toBe(PlaidStagedStatus.ADDED);
  expect((await staged("Farm stand")).status).toBe(PlaidStagedStatus.ADDED);
  const added = await prisma.transaction.findMany({ where: { userId: user.id, amountCents: { in: [1_100, 1_200] } } });
  expect(added.map((t) => t.categoryId)).toEqual([groceries.id, groceries.id]);
  await expect(queue.getByTestId("review-bulk-bar")).toHaveCount(0);

  await queue.getByLabel("Select Bakery").check();
  await queue.getByLabel("Select Parking").check();
  await queue.getByTestId("review-bulk-bar").getByRole("button", { name: "Ignore", exact: true }).click();
  await expect.poll(async () => (await staged("Parking")).status).toBe(PlaidStagedStatus.IGNORED);
  expect((await staged("Bakery")).status).toBe(PlaidStagedStatus.IGNORED);
  expect(await prisma.transaction.count({ where: { userId: user.id, amountCents: { in: [1_300, 1_400] } } })).toBe(0);
});

test("every strong match links in one step", async ({ page }) => {
  const { queue, entries, staged } = await seed(page);

  await queue.getByRole("button", { name: "Link all 2 strong matches" }).click();
  await expect.poll(async () => (await staged("Rogers Wireless")).resolvedTransactionId).toBe(entries[1].id);
  expect((await staged("Hydro Ottawa")).resolvedTransactionId).toBe(entries[0].id);
  for (const entry of entries) {
    expect(await prisma.transactionVerification.count({ where: { transactionId: entry.id } })).toBe(1);
  }
  // The unmatched rows are untouched.
  expect((await staged("Bakery")).status).toBe(PlaidStagedStatus.NEEDS_REVIEW);
});
