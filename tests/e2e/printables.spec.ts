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

test("templates come filled from the user's data or blank, as PDF or CSV", async ({ page }) => {
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

test("the action plan turns the user's figures into steps, for the range chosen", async ({ page }) => {
  const { displayName } = await seedPrintablesDemo(page);
  await page.goto("/reports/print");

  await expect(page.getByTestId("plan-filled-pdf")).toHaveAttribute("href", "/api/printables/action-plan?mode=filled&format=pdf&view=1");
  await page.getByTestId("plan-range").selectOption("6");
  await expect(page.getByTestId("plan-filled-csv")).toHaveAttribute("href", "/api/printables/action-plan?range=6&mode=filled&format=csv");

  const pdf = await page.request.get("/api/printables/action-plan?mode=filled&format=pdf");
  expect(pdf.headers()["content-disposition"]).toMatch(/^attachment; filename="action-plan-24m-filled-\d{4}-\d{2}-\d{2}\.pdf"$/);
  const text = (await pdfPageTexts(await pdf.body())).join("\n");
  for (const expected of [displayName, "Start here", "Next 3 months", "In 1 to 2 years and beyond", "Car Loan", "Trip to Lisbon", "TFSA"]) {
    expect(text, expected).toContain(expected);
  }

  // Six months leaves out the later lists; the yearly car insurance asks for a monthly set-aside.
  const csv = await (await page.request.get((await page.getByTestId("plan-filled-csv").getAttribute("href"))!)).text();
  expect(csv).toContain("When,Done,Area,Step,Why,Amount,Per,By");
  expect(csv).toMatch(/Next 3 months,,Bills,Set aside \$\d+\.\d\d a month for bills that come yearly or quarterly/);
  expect(csv).toContain("Car insurance ($1,200.00)");
  expect(csv).not.toContain("In 6 to 12 months");
  // The demo card owes less than its last two months of charges: cleared each month, not debt.
  expect(csv).toContain("Next 3 months,Yes,Debt,Pay Primary Credit Card in full each month");
  expect(csv).not.toContain("Pay off Primary Credit Card");

  const blank = await (await page.request.get("/api/printables/action-plan?mode=blank&format=csv")).text();
  expect(blank).toContain("Save a starter emergency fund");
  expect(blank).not.toContain("Lisbon");
  expect(blank).not.toMatch(/\d+\.\d\d/);
});

test("the extra templates carry the user's bills, pay and accounts", async ({ page }) => {
  await seedPrintablesDemo(page);
  const csv = async (id: string) => (await page.request.get(`/api/printables/templates/${id}?mode=filled&format=csv`)).text();

  expect(await csv("subscriptions")).toContain("StreamFlix,Recurring Services,Main Chequing,Monthly,18.99,227.88,");
  expect(await csv("sinking-funds")).toMatch(/Car insurance,1200\.00,\d{4}-\d{2}-10,5,240\.00,/);
  // Next month, where every rule's occurrence is still to come whatever today's date.
  await page.goto("/reports/print");
  const nextMonth = await page.getByTestId("template-paycheque").getByRole("combobox").locator("option").nth(1).getAttribute("value");
  const pay = await (await page.request.get(`/api/printables/templates/paycheque?mode=filled&format=csv&month=${nextMonth}`)).text();
  expect(pay).toMatch(new RegExp(`${nextMonth}-15 Northwind Payroll,${nextMonth}-20,Phone plan,55\\.00,Main Chequing,`));
  expect(await csv("accounts")).toContain("Account,Car Loan,Loan,");
  const log = await page.request.get("/api/printables/templates/spending-log?mode=filled&format=pdf");
  const text = (await pdfPageTexts(await log.body())).join("\n");
  expect(text).toContain("Budgets this month");
  expect(text).toContain("$160.00"); // the transport budget
});

test("printables need a signed-in user", async ({ playwright, baseURL }) => {
  const anonymous = await playwright.request.newContext({ baseURL, maxRedirects: 0 });
  for (const path of ["/api/printables/summary", "/api/printables/templates/budget?mode=filled", "/api/printables/action-plan"]) {
    const response = await anonymous.get(path);
    expect(response.headers()["content-type"] ?? "", path).not.toContain("pdf");
    expect([302, 307, 401], path).toContain(response.status());
  }
  await anonymous.dispose();
});
