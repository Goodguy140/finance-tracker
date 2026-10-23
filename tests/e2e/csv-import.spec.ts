import { expect, test, type Page } from "@playwright/test";
import { TransactionType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { expectDashboardHome } from "./expect-dashboard-home";
import { hashTestPassword, signInWithPassword, uniqueStamp } from "./helpers";

const PASSWORD = "e2e-password-123";

async function createUserAndLogin(page: Page) {
  const email = `e2e-csv-import-${uniqueStamp()}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword(PASSWORD),
      displayName: "E2E CSV User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  await signInWithPassword(page, email, PASSWORD);
  await expectDashboardHome(page);
  return user;
}

const CSV = [
  "Date,Description,Amount",
  "2026-03-02,Coffee shop,4.50",
  "2026-03-03,Grocery store,62.10",
  "31/31/2026,Mystery charge,9.99",
].join("\n");

async function importCsv(page: Page, accountName?: string) {
  await page.goto("/settings/import");
  const form = page.locator("form").filter({ hasText: "Import expenses from CSV" });
  await form.locator('input[type="file"]').setInputFiles({
    name: "statement.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(CSV),
  });
  await expect(form.getByText("Skipped: invalid date")).toBeVisible();
  if (accountName) await form.locator('select[name="defaultAccountId"]').selectOption({ label: accountName });
  await form.getByRole("button", { name: "Import CSV" }).click();
  return page.getByRole("dialog");
}

test("CSV import leaves out unreadable dates and skips rows already imported", async ({ page }, testInfo) => {
  const user = await createUserAndLogin(page);

  const first = await importCsv(page);
  await expect(first.getByRole("heading", { name: "Imported 2 expenses" })).toBeVisible();
  await expect(first.getByTestId("csv-import-unreadable-dates")).toContainText("Mystery charge");
  await expect(first.getByTestId("csv-import-unreadable-dates")).toContainText("31/31/2026");
  await page.screenshot({ path: testInfo.outputPath("first-import.png") });
  await first.getByRole("button", { name: "Done" }).click();
  await expect(first).toBeHidden();

  // The summary is returned after the write, so the rows are there by now.
  const titles = async () =>
    (
      await prisma.transaction.findMany({
        where: { userId: user.id, type: TransactionType.EXPENSE },
        select: { title: true },
        orderBy: { title: "asc" },
      })
    ).map((row) => row.title);
  expect(await titles()).toEqual(["Coffee shop", "Grocery store"]);

  const second = await importCsv(page);
  await expect(second.getByRole("heading", { name: "Imported 0 expenses" })).toBeVisible();
  await expect(second.getByTestId("csv-import-duplicates")).toContainText("2 skipped: already in your log");
  await page.screenshot({ path: testInfo.outputPath("second-import.png") });
  expect(await titles()).toEqual(["Coffee shop", "Grocery store"]);
});

test("CSV import does not take the same purchase on another account for a duplicate", async ({ page }) => {
  const user = await createUserAndLogin(page);

  const chequing = await importCsv(page, "Main Chequing");
  await expect(chequing.getByRole("heading", { name: "Imported 2 expenses" })).toBeVisible();
  await chequing.getByRole("button", { name: "Done" }).click();
  await expect(chequing).toBeHidden();

  // The same two lines on the card's statement are the card's own spending.
  const card = await importCsv(page, "Primary Credit Card");
  await expect(card.getByRole("heading", { name: "Imported 2 expenses" })).toBeVisible();
  await expect(card.getByTestId("csv-import-duplicates")).toHaveCount(0);
  await card.getByRole("button", { name: "Done" }).click();
  await expect(card).toBeHidden();

  const rows = await prisma.transaction.findMany({
    where: { userId: user.id, type: TransactionType.EXPENSE },
    select: { title: true, account: { select: { name: true } } },
  });
  const byAccount = (name: string) =>
    rows
      .filter((row) => row.account?.name === name)
      .map((row) => row.title)
      .sort();
  expect(byAccount("Main Chequing")).toEqual(["Coffee shop", "Grocery store"]);
  expect(byAccount("Primary Credit Card")).toEqual(["Coffee shop", "Grocery store"]);

  // And a true re-import of the card's statement is still caught.
  const again = await importCsv(page, "Primary Credit Card");
  await expect(again.getByRole("heading", { name: "Imported 0 expenses" })).toBeVisible();
  await expect(again.getByTestId("csv-import-duplicates")).toContainText("2 skipped: already in your log");
});
