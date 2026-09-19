import { expect, test, type Page } from "@playwright/test";
import { hash } from "bcryptjs";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { encryptSecret } from "../../src/lib/security";
import { expectDashboardHome } from "./expect-dashboard-home";
import { addVirtualAuthenticator, enrolFirstPasskey, openSettingsTab } from "./mfa-helpers";

const PASSWORD = "e2e-password-123";

async function configurePlaid() {
  for (const [key, value] of [
    ["plaid.enabled", "true"],
    ["plaid.clientId", "e2e-client-id"],
    ["plaid.secret", "e2e-secret"],
    ["plaid.env", "sandbox"],
  ]) {
    await prisma.serverSetting.upsert({
      where: { key },
      create: { key, encryptedValue: encryptSecret(value) },
      update: { encryptedValue: encryptSecret(value) },
    });
  }
}

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

test("syncing stages transactions for review, and only a reviewed row reaches the log", async ({
  page,
}, testInfo) => {
  await addVirtualAuthenticator(page);
  const stamp = `${Date.now()}-${testInfo.parallelIndex}`;
  const email = `plaid-sync-${stamp}@example.com`;
  await configurePlaid();

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

  // A transaction the user entered by hand that the bank will also report — this is the
  // row the matcher should propose linking rather than duplicating.
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

  await signIn(page, email);
  await expectDashboardHome(page);
  await enrolFirstPasskey(page, PASSWORD);

  // --- connect and map ---
  await openSettingsTab(page, "banks");
  const panel = page.getByRole("tabpanel", { name: "Banks" });
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
  await openSettingsTab(page, "banks");
  await page.getByRole("tabpanel", { name: "Banks" }).getByRole("button", { name: "Sync now" }).click();

  await expect
    .poll(
      async () =>
        prisma.plaidStagedTransaction.count({
          where: { userId: user.id, status: "NEEDS_REVIEW" },
        }),
      { timeout: 20_000 },
    )
    .toBe(4);

  // Nothing reached the log: the manual row is still the only transaction.
  expect(await prisma.transaction.count({ where: { userId: user.id } })).toBe(1);

  const staged = await prisma.plaidStagedTransaction.findMany({ where: { userId: user.id } });
  const byId = new Map(staged.map((row) => [row.plaidTransactionId, row]));

  // Sign mapping: income positive, refund a NEGATIVE expense rather than income.
  expect(byId.get("fake-txn-payroll")!.type).toBe("INCOME");
  expect(byId.get("fake-txn-payroll")!.amountCents).toBe(250000);
  expect(byId.get("fake-txn-refund")!.type).toBe("EXPENSE");
  expect(byId.get("fake-txn-refund")!.amountCents).toBe(-4590);

  // The matcher proposed the hand-entered coffee, and nothing else claimed it.
  const coffee = byId.get("fake-txn-coffee")!;
  expect(coffee.matchTransactionId).toBe(manual.id);
  expect(coffee.matchTier).toBe("high");
  expect(byId.get("fake-txn-groceries")!.matchTransactionId).toBeNull();

  // --- review on the dashboard ---
  await page.goto("/");
  const queue = page.locator("section").filter({ hasText: "From your bank" }).first();
  await expect(queue).toBeVisible();
  await expect(queue.getByText("Loblaws")).toBeVisible();

  // The proposed link is surfaced, not applied silently.
  await expect(queue.getByText(/Looks like/i)).toBeVisible();

  // Link the coffee to what the user already entered.
  const coffeeCard = queue.locator("li").filter({ hasText: "Blue Bottle Coffee" }).first();
  await coffeeCard.getByRole("button", { name: "Link it" }).click();

  await expect
    .poll(async () => prisma.transactionVerification.count({ where: { userId: user.id } }), {
      timeout: 15_000,
    })
    .toBe(1);

  const verification = await prisma.transactionVerification.findFirstOrThrow({
    where: { userId: user.id },
  });
  expect(verification.transactionId).toBe(manual.id);
  expect(verification.source).toBe("MATCHED");
  expect(verification.institutionName).toBe("Test Credit Union");
  // Linking must not create a second transaction.
  expect(await prisma.transaction.count({ where: { userId: user.id } })).toBe(1);

  // --- the badge appears in the log ---
  await page.goto("/");
  await expect(page.getByTitle(/Matched to Test Credit Union/i).first()).toBeVisible({
    timeout: 15_000,
  });

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
    .toBe(2);

  const added = await prisma.transaction.findFirstOrThrow({
    where: { userId: user.id, title: "Loblaws" },
    include: { verification: true },
  });
  expect(added.amountCents).toBe(8421);
  expect(added.accountId).toBe(account.id);
  expect(added.verification?.source).toBe("IMPORTED");

  // --- a second sync is a no-op: nothing is re-proposed ---
  await openSettingsTab(page, "banks");
  await page.getByRole("tabpanel", { name: "Banks" }).getByRole("button", { name: "Sync now" }).click();
  await page.waitForTimeout(2_000);
  expect(
    await prisma.plaidStagedTransaction.count({
      where: { userId: user.id, status: "NEEDS_REVIEW" },
    }),
  ).toBe(2);
  expect(await prisma.transaction.count({ where: { userId: user.id } })).toBe(2);
});
