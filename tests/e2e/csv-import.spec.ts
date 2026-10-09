import { expect, test, type Page } from "@playwright/test";
import { hash } from "bcryptjs";
import { TransactionType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { expectDashboardHome } from "./expect-dashboard-home";
import { uniqueStamp } from "./helpers";

const PASSWORD = "e2e-password-123";

async function createUserAndLogin(page: Page) {
  const email = `e2e-csv-import-${uniqueStamp()}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hash(PASSWORD, 12),
      displayName: "E2E CSV User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Login" }).click();
  await expectDashboardHome(page);
  return user;
}

const CSV = [
  "Date,Description,Amount",
  "2026-03-02,Coffee shop,4.50",
  "2026-03-03,Grocery store,62.10",
  "31/31/2026,Mystery charge,9.99",
].join("\n");

async function importCsv(page: Page) {
  await page.goto("/settings#accounts");
  const form = page.locator("form").filter({ hasText: "Import expenses from CSV" });
  await form.locator('input[type="file"]').setInputFiles({
    name: "statement.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(CSV),
  });
  await expect(form.getByText("Skipped: invalid date")).toBeVisible();
  await form.getByRole("button", { name: "Import CSV" }).click();
  return page.getByRole("dialog");
}

test("CSV import leaves out unreadable dates and skips rows already imported", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Settings flow is covered by the chromium project");
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
