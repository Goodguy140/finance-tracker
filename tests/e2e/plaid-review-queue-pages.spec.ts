import { expect, test } from "@playwright/test";
import { hash } from "bcryptjs";
import { TransactionType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { encryptSecret } from "../../src/lib/security";
import { REVIEW_QUEUE_PAGE_SIZE } from "../../src/lib/plaid/review-queue-page";
import { expectDashboardHome } from "./expect-dashboard-home";
import { uniqueStamp } from "./helpers";

test("a review queue longer than a page says how many rows it holds and shows the rest on request", async ({ page }) => {
  const stamp = uniqueStamp();
  const email = `e2e-queue-pages-${stamp}@example.com`;
  const password = "e2e-password-123";
  const total = REVIEW_QUEUE_PAGE_SIZE + 5;

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hash(password, 12),
      displayName: "E2E Queue Pages User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  const account = await prisma.account.findFirstOrThrow({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
  // Synced just now, so nothing tries to reach Plaid for it: the rows are already staged.
  const item = await prisma.plaidItem.create({
    data: {
      userId: user.id,
      itemId: `queue-pages-item-${stamp}`,
      accessTokenEnc: encryptSecret(`access-sandbox-queue-pages-${stamp}`),
      institutionName: "Test Credit Union",
      requestedDays: 90,
      historyCutoff: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
      lastSyncedAt: new Date(),
    },
  });
  const plaidAccount = await prisma.plaidAccount.create({
    data: {
      userId: user.id,
      plaidItemId: item.id,
      plaidAccountId: `queue-pages-acct-${stamp}`,
      name: "Chequing",
      plaidType: "depository",
      accountId: account.id,
    },
  });
  // Mid-month UTC date so the dashboard's month period contains it in any timezone.
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15));
  await prisma.plaidStagedTransaction.createMany({
    data: Array.from({ length: total }, (_, i) => ({
      userId: user.id,
      plaidItemId: item.id,
      plaidAccountRowId: plaidAccount.id,
      plaidTransactionId: `queue-pages-${stamp}-${i}`,
      // Zero-padded so the queue's name order is the creation order. The queue drops the
      // digits from the heading, so the amount is what tells rows apart on screen.
      name: `Coffee ${String(i).padStart(3, "0")}`,
      amountCents: 500 + i,
      type: TransactionType.EXPENSE,
      date,
      suggestedAccountId: account.id,
    })),
  });

  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Login" }).click();
  await expectDashboardHome(page);
  // The month filter writes the period into the URL once on load; clicking before that
  // lands would have its navigation replaced.
  await expect(page).toHaveURL(/[?&]month=/);

  const queue = page.locator("section").filter({ hasText: "From your bank" }).first();
  const cards = queue.getByTestId("review-queue-row");
  await expect(queue.getByTitle(`To review: ${total}`)).toBeVisible();
  await expect(cards).toHaveCount(REVIEW_QUEUE_PAGE_SIZE);
  // Same date, so name order decides; the last-created row ($7.04) is the one left off.
  const lastRow = queue.getByText(/^\$7\.04$/);
  await expect(queue.getByText(/^\$5\.00$/).first()).toBeVisible();
  await expect(lastRow).toHaveCount(0);
  const more = queue.getByTestId("review-queue-more");
  await expect(more).toContainText(`Showing the newest ${REVIEW_QUEUE_PAGE_SIZE} of ${total}`);

  await more.getByRole("button", { name: "Show 5 more" }).click();
  await expect(page).toHaveURL(/[?&]queue=400/);
  await expect(cards).toHaveCount(total);
  await expect(lastRow.first()).toBeVisible();
  await expect(queue.getByTestId("review-queue-more")).toHaveCount(0);
});
