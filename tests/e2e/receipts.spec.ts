import { expect, test } from "@playwright/test";
import { CategoryKind, TransactionType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { expectDashboardHome } from "./expect-dashboard-home";
import { expenseLogLocator, hashTestPassword, signInWithPassword, uniqueStamp } from "./helpers";

// A 1×1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

test("a receipt can be attached to an expense, opened, and removed", async ({ page }) => {
  const stamp = uniqueStamp();
  const email = `e2e-receipts-${stamp}@example.com`;
  const password = "e2e-password-123";
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword(password),
      displayName: "E2E Receipts",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  const category = await prisma.category.findFirstOrThrow({ where: { userId: user.id, kind: CategoryKind.EXPENSE } });
  const now = new Date();
  const title = `Hardware store ${stamp}`;
  const expense = await prisma.transaction.create({
    data: {
      userId: user.id,
      type: TransactionType.EXPENSE,
      amountCents: 3_499,
      date: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15)),
      title,
      categoryId: category.id,
    },
  });

  await signInWithPassword(page, email, password);
  await expectDashboardHome(page);
  await expect(page).toHaveURL(/[?&]month=/);
  const log = expenseLogLocator(page);
  await log.getByRole("button").filter({ hasText: title }).filter({ visible: true }).first().click();
  const editor = page.getByRole("dialog", { name: "Edit expense" });
  const receipts = editor.getByTestId("receipts");
  await receipts.getByLabel("Attach receipt").setInputFiles({ name: "till slip.png", mimeType: "image/png", buffer: PNG });

  const link = receipts.getByRole("link", { name: "till slip.png" });
  await expect(link).toBeVisible();
  const stored = await prisma.transactionAttachment.findFirstOrThrow({ where: { transactionId: expense.id } });
  expect(stored).toMatchObject({ contentType: "image/png", sizeBytes: PNG.length });

  const response = await page.request.get(`/api/attachments/${stored.id}`);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/png");
  expect(Buffer.from(await response.body()).equals(PNG)).toBe(true);

  // The row says it has one.
  await editor.getByRole("button", { name: "Cancel" }).click();
  await expect(log.getByTestId("receipt-indicator").filter({ visible: true }).first()).toHaveText("Receipt");

  await log.getByRole("button").filter({ hasText: title }).filter({ visible: true }).first().click();
  await receipts.getByRole("button", { name: "Remove till slip.png" }).click();
  await receipts.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(link).toBeHidden();
  expect(await prisma.transactionAttachment.count({ where: { transactionId: expense.id } })).toBe(0);
});

test("a file that is not an image or PDF is refused", async ({ page }) => {
  const stamp = uniqueStamp();
  const email = `e2e-receipts-bad-${stamp}@example.com`;
  const password = "e2e-password-123";
  const user = await prisma.user.create({
    data: { email, passwordHash: await hashTestPassword(password), displayName: "E2E", countryCode: "CA", role: "USER" },
  });
  await ensureDefaultDataForUser(user);
  const category = await prisma.category.findFirstOrThrow({ where: { userId: user.id, kind: CategoryKind.EXPENSE } });
  const now = new Date();
  const title = `Odd file ${stamp}`;
  await prisma.transaction.create({
    data: {
      userId: user.id,
      type: TransactionType.EXPENSE,
      amountCents: 100,
      date: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15)),
      title,
      categoryId: category.id,
    },
  });
  await signInWithPassword(page, email, password);
  await expectDashboardHome(page);
  await expect(page).toHaveURL(/[?&]month=/);
  const log = expenseLogLocator(page);
  await log.getByRole("button").filter({ hasText: title }).filter({ visible: true }).first().click();
  const receipts = page.getByRole("dialog", { name: "Edit expense" }).getByTestId("receipts");
  await receipts.getByLabel("Attach receipt").setInputFiles({
    name: "receipt.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
  });
  await expect(page.getByRole("alertdialog")).toContainText("Only photos");
  expect(await prisma.transactionAttachment.count({ where: { userId: user.id } })).toBe(0);
});
