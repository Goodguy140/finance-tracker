import { expect, test, type Page } from "@playwright/test";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { expectDashboardHome } from "./expect-dashboard-home";
import { addExpenseOnDashboard, hashTestPassword, signInWithPassword, uniqueStamp } from "./helpers";

const pad = (n: number) => String(n).padStart(2, "0");

function todayYmd(reference = new Date()) {
  return `${reference.getFullYear()}-${pad(reference.getMonth() + 1)}-${pad(reference.getDate())}`;
}

async function createUser(stamp: string, label: string) {
  const email = `e2e-subs-${label}-${stamp}@example.com`;
  const password = "e2e-password-123";
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword(password),
      displayName: "E2E Subscriptions User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  return { user, email, password };
}

async function login(page: Page, email: string, password: string) {
  await signInWithPassword(page, email, password);
  await expectDashboardHome(page);
}

async function openSubscriptionsTab(page: Page) {
  // Reached through the Settings home, the way a phone gets there with no sidebar.
  await page.goto("/settings");
  await page.getByRole("region", { name: "Money" }).getByRole("link", { name: /^Subscriptions/ }).click();
  await expect(page.getByRole("region", { name: "Subscriptions", exact: true })).toBeVisible();
}

test("settings: create a shared subscription and toggle paid / bill-sent", async ({ page }) => {
  const stamp = uniqueStamp();
  const { user, email, password } = await createUser(stamp, "create");

  await login(page, email, password);
  await openSubscriptionsTab(page);

  const panel = page.getByRole("region", { name: "Subscriptions", exact: true });
  const name = `Netflix ${stamp}`;

  // Happy path: open "New subscription", fill the form and submit.
  await panel.getByRole("button", { name: "New subscription" }).click();
  const dialog = page.getByRole("dialog", { name: "New subscription" });
  await dialog.getByPlaceholder("e.g. Netflix, internet, gym").fill(name);
  await dialog.locator('input[name="amount"]').fill("20.00");
  await dialog.locator('input[name="nextExpectedDate"]').fill(todayYmd());
  await dialog.getByRole("button", { name: "Add subscription" }).click();
  await expect(dialog).toBeHidden();

  // The new card appears in "Your subscriptions".
  await expect(panel.getByText(name, { exact: true })).toBeVisible({ timeout: 15_000 });

  // Split it with one person, from the card's add-person form.
  await panel.getByPlaceholder("Name").fill("Alex");
  const shareInput = panel.locator('input[name="share"]');
  await shareInput.fill("5.00");
  // Submit via Enter: the add-person button sits at the very bottom edge on mobile, where a
  // click races the viewport scroll. A native form submit is equivalent and stable.
  await shareInput.press("Enter");

  await expect(panel.getByText("Alex", { exact: true })).toBeVisible({ timeout: 15_000 });

  // Paid / unpaid + bill-sent toggles flip their pressed state.
  const billSent = panel.getByRole("button", { name: "Bill sent" });
  const paid = panel.getByRole("button", { name: "Paid" });

  await expect(paid).toHaveAttribute("aria-pressed", "false");
  await paid.click();
  await expect(paid).toHaveAttribute("aria-pressed", "true");

  await expect(billSent).toHaveAttribute("aria-pressed", "false");
  await billSent.click();
  await expect(billSent).toHaveAttribute("aria-pressed", "true");

  // Toggle paid back off.
  await paid.click();
  await expect(paid).toHaveAttribute("aria-pressed", "false");

  // The paid toggle persisted a share-status row scoped to this member.
  const member = await prisma.subscriptionMember.findFirstOrThrow({ where: { userId: user.id, name: "Alex" } });
  const status = await prisma.subscriptionShareStatus.findFirstOrThrow({ where: { memberId: member.id } });
  expect(status.paid).toBe(false);
  expect(status.billSent).toBe(true);
});

test("dashboard: skip a subscription by linking an existing expense", async ({ page }) => {
  const stamp = uniqueStamp();
  const { user, email, password } = await createUser(stamp, "skip");

  const account = await prisma.account.findFirstOrThrow({ where: { userId: user.id } });
  const category = await prisma.category.findFirstOrThrow({ where: { userId: user.id, kind: "EXPENSE" } });
  const now = new Date();
  const nextExpectedDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const subName = `Gym ${stamp}`;
  const rule = await prisma.recurringTransaction.create({
    data: {
      userId: user.id,
      accountId: account.id,
      categoryId: category.id,
      type: "EXPENSE",
      name: subName,
      amountCents: 2000,
      cadence: "MONTHLY",
      nextExpectedDate,
      enabled: true,
    },
  });

  await login(page, email, password);

  // Add an unlinked expense to link against, then reload so the dashboard hydrates it into the
  // skip modal's "pick an expense" list.
  const expenseTitle = `Gym charge ${stamp}`;
  await addExpenseOnDashboard(page, test.info().project.name, expenseTitle, "20.00");
  await page.reload();
  await expectDashboardHome(page);

  const recurringPanel = page
    .getByRole("region", { name: "Recurring transactions" });
  await recurringPanel.getByRole("button", { name: "Skip" }).click();

  const modal = page.getByText(`Skip ${subName}`).locator("..");
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: /already in the expense log/ }).click();
  await modal.getByText("Pick the transaction").click();
  await modal.locator("select").selectOption({ index: 1 });
  await modal.getByRole("button", { name: "Link & advance" }).click();

  // The expense is now linked to the rule and the rule advanced to the next month.
  await expect
    .poll(async () => {
      const txn = await prisma.transaction.findFirst({ where: { userId: user.id, title: expenseTitle } });
      return txn?.recurringTransactionId;
    })
    .toBe(rule.id);

  const advanced = await prisma.recurringTransaction.findUniqueOrThrow({ where: { id: rule.id } });
  expect(advanced.nextExpectedDate.getTime()).toBeGreaterThan(nextExpectedDate.getTime());

  // The modal closed after linking.
  await expect(page.getByText(`Skip ${subName}`)).toHaveCount(0);
});
