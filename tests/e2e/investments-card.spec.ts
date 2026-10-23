import { expect, test, type Page } from "@playwright/test";
import { AccountType, CategoryKind, TransactionType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { dateFromYmd } from "../../src/lib/date-only";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { currentYmdInTimeZone } from "../../src/lib/period-month";
import { expectDashboardHome } from "./expect-dashboard-home";
import { hashTestPassword, signInWithPassword, uniqueStamp } from "./helpers";


async function signInWithTfsa(page: Page, label: string) {
  const stamp = uniqueStamp();
  const email = `e2e-investments-${label}-${stamp}@example.com`;
  const password = "e2e-password-123";
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword(password),
      displayName: "E2E Investments User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  const tfsa = await prisma.account.create({
    data: { userId: user.id, name: `Card TFSA ${stamp}`, type: AccountType.TFSA },
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await signInWithPassword(page, email, password);
  await expectDashboardHome(page);
  return { user, tfsa, stamp };
}

/** Investments is the second tab on the Insights card in the default layout. */
async function openInvestmentsCard(page: Page) {
  const stack = page.getByRole("region", { name: "Insights, Investments" });
  await stack.getByRole("tab", { name: "Investments" }).click();
  return stack.getByRole("tabpanel");
}

test("a contribution is recorded, edited and deleted from the Investments card", async ({ page }) => {
  const { user, tfsa } = await signInWithTfsa(page, "flow");

  const card = await openInvestmentsCard(page);
  const flowForm = card.locator("form").filter({ has: page.locator('select[name="direction"]') });
  await flowForm.locator('select[name="accountId"]').selectOption(tfsa.id);
  await flowForm.locator('input[name="amount"]').fill("250");
  await flowForm.getByRole("button", { name: "Add investment flow" }).click();

  const row = card.getByRole("listitem").filter({ hasText: "Contribution" }).filter({ hasText: tfsa.name });
  await expect(row).toContainText("$250.00");
  const flow = await prisma.investmentFlow.findFirstOrThrow({ where: { userId: user.id } });

  await row.getByRole("button", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit contribution or withdrawal" });
  await dialog.getByLabel("Amount").fill("275.50");
  await dialog.getByLabel("Note").fill("Corrected");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(async () => {
      const current = await prisma.investmentFlow.findUnique({ where: { id: flow.id } });
      return current ? { amountCents: current.amountCents, note: current.note } : null;
    })
    .toEqual({ amountCents: 27550, note: "Corrected" });
  await expect(row).toContainText("$275.50");

  await row.getByRole("button", { name: "Delete" }).click();
  const confirm = row.getByRole("group", { name: "Delete this contribution?" });
  await confirm.getByRole("button", { name: "Keep" }).click();
  expect(await prisma.investmentFlow.count({ where: { id: flow.id } })).toBe(1);
  await row.getByRole("button", { name: "Delete" }).click();
  await row.getByRole("group", { name: "Delete this contribution?" }).getByRole("button", { name: "Delete" }).click();
  await expect.poll(() => prisma.investmentFlow.count({ where: { id: flow.id } })).toBe(0);
});

test("a portfolio value is edited and deleted from the Investments card", async ({ page }) => {
  const { user, tfsa } = await signInWithTfsa(page, "snapshot");
  const snapshot = await prisma.portfolioSnapshot.create({
    data: {
      userId: user.id,
      accountId: tfsa.id,
      totalValueCents: 1_000_000,
      date: dateFromYmd(currentYmdInTimeZone("America/Toronto")),
    },
  });
  await page.reload();
  await expectDashboardHome(page);

  const card = await openInvestmentsCard(page);
  const row = card.getByRole("listitem").filter({ hasText: "Portfolio value" });
  await expect(row).toContainText("$10,000.00");
  await row.getByRole("button", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit portfolio value" });
  await dialog.getByLabel("Total portfolio value").fill("10500");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect
    .poll(async () => (await prisma.portfolioSnapshot.findUnique({ where: { id: snapshot.id } }))?.totalValueCents)
    .toBe(1_050_000);

  await row.getByRole("button", { name: "Delete" }).click();
  await row.getByRole("group", { name: "Delete this portfolio value?" }).getByRole("button", { name: "Delete" }).click();
  await expect.poll(() => prisma.portfolioSnapshot.count({ where: { id: snapshot.id } })).toBe(0);
});

test("a transfer into a TFSA counts toward room once", async ({ page }) => {
  const { user, tfsa, stamp } = await signInWithTfsa(page, "transfer");
  const transferCategory = await prisma.category.create({
    data: { userId: user.id, name: `Transfers ${stamp}`, kind: CategoryKind.TRANSFER },
  });
  const title = `TFSA deposit ${stamp}`;
  // Transfers follow the expense sign: money arriving in the row's account is negative.
  const transfer = await prisma.transaction.create({
    data: {
      userId: user.id,
      accountId: tfsa.id,
      categoryId: transferCategory.id,
      type: TransactionType.TRANSFER,
      amountCents: -50_000,
      title,
      date: dateFromYmd(currentYmdInTimeZone("America/Toronto")),
    },
  });
  await page.reload();
  await expectDashboardHome(page);

  const card = await openInvestmentsCard(page);
  const transferRow = card.getByRole("listitem").filter({ hasText: "Transfer in" });
  await expect(transferRow).toContainText(title);
  await expect(transferRow).toContainText("$500.00");
  await transferRow.getByRole("button", { name: "Count toward room" }).click();

  await expect
    .poll(async () => {
      const flow = await prisma.investmentFlow.findFirst({ where: { userId: user.id } });
      return flow ? { transactionId: flow.transactionId, amountCents: flow.amountCents, direction: flow.direction } : null;
    })
    .toEqual({ transactionId: transfer.id, amountCents: 50_000, direction: "CONTRIBUTION" });

  // The transfer is now represented by its contribution, and cannot be offered again.
  await expect(transferRow).toHaveCount(0);
  await expect(card.getByRole("listitem").filter({ hasText: "Contribution" })).toContainText("From transfer");
  await expect(card.getByRole("button", { name: "Count toward room" })).toHaveCount(0);
});
