import { expect, test } from "@playwright/test";
import { pdfPageTexts } from "../../src/lib/printables/test-pdf-text";
import { seedPrintablesDemo } from "./printables-seed";

test("Reports links to the printable summary, which carries the user's own figures", async ({ page }) => {
  const { displayName } = await seedPrintablesDemo(page);

  await page.goto("/reports?period=12m");
  await expect(page.getByTestId("reports-print-link")).toHaveAttribute("href", "/reports/print");
  await page.goto("/reports/print");
  await expect(page.getByRole("heading", { name: "Print and templates", level: 1 })).toBeVisible();
  await expect(page.getByTestId("summary-download")).toHaveAttribute("href", "/api/printables/summary");
  await expect(page.getByTestId("template-budget")).toBeVisible();

  const response = await page.request.get("/api/printables/summary");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("application/pdf");
  expect(response.headers()["content-disposition"]).toMatch(/^attachment; filename="financial-summary-12m-\d{4}-\d{2}-\d{2}\.pdf"$/);
  const text = (await pdfPageTexts(await response.body())).join("\n");
  expect(text).toContain(displayName);
  // A year of pay: 23 cheques of $2,650 (this month's first one lands only after the 1st).
  expect(text).toMatch(/\$(5[89]|6[01]),\d{3}\.\d\d/);
  for (const expected of ["Groceries", "Budgets,", "Emergency fund", "Trip to Lisbon", "Bright Internet", "Car Loan", "TFSA", "FreshMart"]) {
    expect(text, expected).toContain(expected);
  }
});

test("templates come filled from the user's data or blank, as PDF or CSV", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Downloads are the same on every viewport");
  await seedPrintablesDemo(page);
  await page.goto("/reports/print");

  const goalsFilled = page.getByTestId("template-goals-filled-csv");
  const filledHref = await goalsFilled.getAttribute("href");
  expect(filledHref).toBe("/api/printables/templates/goals?mode=filled&format=csv");
  const filled = await page.request.get(filledHref!);
  expect(filled.headers()["content-type"]).toBe("text/csv; charset=utf-8");
  const filledCsv = await filled.text();
  expect(filledCsv).toContain("Trip to Lisbon,4000.00");
  expect(filledCsv).toContain("Emergency fund,15000.00");

  const blank = await page.request.get((await page.getByTestId("template-goals-blank-csv").getAttribute("href"))!);
  const blankCsv = await blank.text();
  expect(blankCsv).toContain("Goal,Target");
  expect(blankCsv).not.toContain("Lisbon");

  // The month picker follows into the link.
  const card = page.getByTestId("template-budget");
  const nextMonth = await card.getByRole("combobox").locator("option").nth(1).getAttribute("value");
  await card.getByRole("combobox").selectOption(nextMonth!);
  await expect(page.getByTestId("template-budget-filled-pdf")).toHaveAttribute(
    "href",
    `/api/printables/templates/budget?mode=filled&format=pdf&month=${nextMonth}&view=1`,
  );
  const budget = await page.request.get((await page.getByTestId("template-budget-filled-pdf").getAttribute("href"))!);
  expect(budget.headers()["content-disposition"]).toMatch(/^inline;/);
  const budgetText = (await pdfPageTexts(await budget.body())).join("\n");
  expect(budgetText).toContain("Monthly budget worksheet");
  expect(budgetText).toContain("$160.00"); // the transport budget
  expect(budgetText).toContain("$2,650.00"); // the monthly pay rule, expected
  expect(budgetText).toContain("$5,300.00"); // the last full month: two pay cheques

  // The empty-rows choice follows into every template's links.
  await page.getByTestId("template-rows").selectOption("8");
  await expect(page.getByTestId("template-debt-blank-csv")).toHaveAttribute("href", "/api/printables/templates/debt?mode=blank&format=csv&rows=8");

  // This month's rent was already posted from its rule: it is on the calendar, marked paid.
  const bills = await page.request.get("/api/printables/templates/bills?mode=filled&format=csv");
  expect(await bills.text()).toMatch(/\d{4}-\d{2}-01,Rent,Bill,1750\.00,Main Chequing,\d{4}-\d{2}-01/);

  const missing = await page.request.get("/api/printables/templates/nope");
  expect(missing.status()).toBe(404);
});

test("printables need a signed-in user", async ({ playwright, baseURL }) => {
  const anonymous = await playwright.request.newContext({ baseURL, maxRedirects: 0 });
  for (const path of ["/api/printables/summary", "/api/printables/templates/budget?mode=filled"]) {
    const response = await anonymous.get(path);
    expect(response.headers()["content-type"] ?? "", path).not.toContain("pdf");
    expect([302, 307, 401], path).toContain(response.status());
  }
  await anonymous.dispose();
});
