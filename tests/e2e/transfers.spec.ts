import { expect, test } from "@playwright/test";
import { AccountType, CategoryKind, PlaidStagedStatus, TransactionType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { encryptSecret } from "../../src/lib/security";
import { expectDashboardHome } from "./expect-dashboard-home";
import { expenseLogLocator, hashTestPassword, signInWithPassword, uniqueStamp } from "./helpers";

test("an expense marked as a transfer leaves the log for the transfers list, and comes back", async ({ page }) => {
  const stamp = uniqueStamp();
  const email = `e2e-transfer-${stamp}@example.com`;
  const password = "e2e-password-123";

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword(password),
      displayName: "E2E Transfer User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  const [category, account] = await Promise.all([
    prisma.category.findFirstOrThrow({ where: { userId: user.id, kind: CategoryKind.EXPENSE } }),
    prisma.account.findFirstOrThrow({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
  ]);

  // Mid-month UTC date so the dashboard's month period contains it in any timezone.
  const now = new Date();
  const title = `Visa payment ${stamp}`;
  const payment = await prisma.transaction.create({
    data: {
      userId: user.id,
      type: TransactionType.EXPENSE,
      amountCents: 40000,
      date: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15)),
      title,
      categoryId: category.id,
      accountId: account.id,
    },
  });

  await signInWithPassword(page, email, password);
  await expectDashboardHome(page);

  const log = expenseLogLocator(page);
  await log.getByRole("button").filter({ hasText: title }).filter({ visible: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Edit expense" });
  await dialog.getByRole("button", { name: "Mark as transfer" }).click();
  await expect(dialog).toBeHidden();

  // One write: the update that moves it.
  await expect
    .poll(async () => {
      const row = await prisma.transaction.findUniqueOrThrow({
        where: { id: payment.id },
        include: { category: true },
      });
      return [row.type, row.amountCents, row.category.kind];
    })
    .toEqual([TransactionType.TRANSFER, 40000, CategoryKind.TRANSFER]);

  await expect(log.getByText("No expenses in this period.").filter({ visible: true })).toHaveCount(1);
  const transfers = log.getByTestId("transfer-log").filter({ visible: true });
  await expect(transfers).toContainText("Transfers · 1");
  await transfers.getByRole("button", { name: /Transfers/ }).click();
  await expect(transfers).toContainText(title);
  await expect(transfers).toContainText("Out $400.00");

  await transfers.getByRole("button", { name: "Not a transfer: count as an expense" }).click();
  await expect
    .poll(async () => {
      const row = await prisma.transaction.findUniqueOrThrow({
        where: { id: payment.id },
        include: { category: true },
      });
      return [row.type, row.amountCents, row.category.kind];
    })
    .toEqual([TransactionType.EXPENSE, 40000, CategoryKind.EXPENSE]);
  await expect(log.getByTestId("transfer-log")).toHaveCount(0);
  await expect(log.getByText(title).filter({ visible: true }).first()).toBeVisible();
});

test("a card payment synced from both banks is added as one paired transfer, and can be unpaired", async ({ page }) => {
  const stamp = uniqueStamp();
  const email = `e2e-transfer-pair-${stamp}@example.com`;
  const password = "e2e-password-123";

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword(password),
      displayName: "E2E Transfer Pair User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  const [chequing, visa] = await Promise.all([
    prisma.account.create({ data: { userId: user.id, name: `Chequing ${stamp}`, type: AccountType.CHEQUING } }),
    prisma.account.create({ data: { userId: user.id, name: `Visa ${stamp}`, type: AccountType.CREDIT_CARD } }),
  ]);
  // Synced just now, so nothing tries to reach Plaid for it: the rows are already staged.
  const item = await prisma.plaidItem.create({
    data: {
      userId: user.id,
      itemId: `pair-item-${stamp}`,
      accessTokenEnc: encryptSecret(`access-sandbox-pair-${stamp}`),
      institutionName: "Test Credit Union",
      requestedDays: 90,
      historyCutoff: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
      lastSyncedAt: new Date(),
    },
  });
  const now = new Date();
  const stageLeg = async (accountId: string, plaidAccountId: string, name: string, amountCents: number, day: number) => {
    const plaidAccount = await prisma.plaidAccount.create({
      data: { userId: user.id, plaidItemId: item.id, plaidAccountId, name, plaidType: "depository", accountId },
    });
    return prisma.plaidStagedTransaction.create({
      data: {
        userId: user.id,
        plaidItemId: item.id,
        plaidAccountRowId: plaidAccount.id,
        plaidTransactionId: `${plaidAccountId}-txn`,
        name,
        amountCents,
        type: TransactionType.TRANSFER,
        date: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day)),
        suggestedAccountId: accountId,
      },
    });
  };
  const out = await stageLeg(chequing.id, `pair-chq-${stamp}`, "VISA PAYMENT", 40000, 14);
  const arrived = await stageLeg(visa.id, `pair-visa-${stamp}`, "PAYMENT THANK YOU", -40000, 15);

  await signInWithPassword(page, email, password);
  await expectDashboardHome(page);

  const queue = page.locator("section").filter({ hasText: "From your bank" }).first();
  const outCard = queue.locator("li").filter({ hasText: /visa payment/i }).first();
  await expect(outCard).toContainText("Looks like the other side of a transfer");
  // Pairing is what the queue proposes for both rows.
  await outCard.getByRole("button", { name: /^More options for/ }).click();
  await expect(outCard.getByRole("button", { name: "Pair as transfer" })).toHaveAttribute("aria-pressed", "true");
  await outCard.getByRole("button", { name: "Pair", exact: true }).click();

  // The last write links the arriving leg back to the leaving one.
  await expect
    .poll(async () => {
      const legs = await prisma.transaction.findMany({
        where: { userId: user.id, type: TransactionType.TRANSFER },
        orderBy: { amountCents: "desc" },
      });
      return legs.map((leg) => [leg.amountCents, leg.accountId, leg.transferAccountId, leg.transferPeerId !== null]);
    })
    .toEqual([
      [40000, chequing.id, visa.id, true],
      [-40000, visa.id, chequing.id, true],
    ]);
  const statuses = await prisma.plaidStagedTransaction.findMany({ where: { id: { in: [out.id, arrived.id] } } });
  expect(statuses.map((row) => row.status)).toEqual([PlaidStagedStatus.ADDED, PlaidStagedStatus.ADDED]);

  // Listed once, from one account to the other, outside every total.
  const log = expenseLogLocator(page);
  const transfers = log.getByTestId("transfer-log").filter({ visible: true });
  await expect(transfers).toContainText("Transfers · 1");
  await transfers.getByRole("button", { name: /Transfers/ }).click();
  await expect(transfers).toContainText(`FromChequing ${stamp}`);
  await expect(transfers).toContainText(`ToVisa ${stamp}`);
  await expect(transfers).toContainText("Out $400.00");

  await transfers.getByRole("button", { name: "Unpair" }).click();
  await expect
    .poll(async () => prisma.transaction.count({ where: { userId: user.id, transferPeerId: { not: null } } }))
    .toBe(0);
  await expect(transfers).toContainText("Transfers · 2");
});

test("a transfer entered by hand goes to the transfers list, from one account to the other", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "The Add card is the desktop layout");
  const stamp = uniqueStamp();
  const email = `e2e-transfer-manual-${stamp}@example.com`;
  const password = "e2e-password-123";

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword(password),
      displayName: "E2E Manual Transfer User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  const [chequing, savings] = await Promise.all([
    prisma.account.create({ data: { userId: user.id, name: `Chequing ${stamp}`, type: AccountType.CHEQUING } }),
    prisma.account.create({ data: { userId: user.id, name: `Savings ${stamp}`, type: AccountType.SAVINGS } }),
  ]);

  await signInWithPassword(page, email, password);
  await expectDashboardHome(page);

  const card = page.getByRole("region", { name: "Add", exact: true });
  await card.getByRole("radio", { name: "Transfer" }).click();
  await card.getByLabel("From account").selectOption(chequing.id);
  await card.getByLabel("To account").selectOption(savings.id);
  await card.getByLabel("Amount").fill("300");
  await card.locator('textarea[name="title"]').fill(`Top up ${stamp}`);
  await card.getByRole("button", { name: "Add transfer" }).click();

  await expect
    .poll(async () =>
      (await prisma.transaction.findMany({ where: { userId: user.id, type: TransactionType.TRANSFER } })).map((row) => [
        row.amountCents,
        row.accountId,
        row.transferAccountId,
        row.title,
      ]),
    )
    .toEqual([[30000, chequing.id, savings.id, `Top up ${stamp}`]]);
  expect(await prisma.transaction.count({ where: { userId: user.id, type: { not: TransactionType.TRANSFER } } })).toBe(0);

  const transfers = expenseLogLocator(page).getByTestId("transfer-log").filter({ visible: true });
  await expect(transfers).toContainText("Transfers · 1");
  await transfers.getByRole("button", { name: /Transfers/ }).click();
  await expect(transfers).toContainText(`FromChequing ${stamp}`);
  await expect(transfers).toContainText(`ToSavings ${stamp}`);
  await expect(transfers).toContainText("Out $300.00");
});
