import type { Page } from "@playwright/test";
import { hash } from "bcryptjs";
import { AccountType, CategoryKind, RecurringCadence, TransactionType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { TRANSFER_CATEGORY_NAME } from "../../src/lib/transfer-type";
import { expectDashboardHome } from "./expect-dashboard-home";
import { uniqueStamp } from "./helpers";

/** The `day` of the month `monthsBack` before this one, as a stored date-only value. */
function dayOfMonthsAgo(monthsBack: number, day: number) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, day));
}

function ym(monthsBack: number) {
  return dayOfMonthsAgo(monthsBack, 1).toISOString().slice(0, 7);
}

/**
 * A made-up household with a year of history: pay, rent, groceries and the rest, budgets with
 * rollover, balances on five accounts, recurring bills, two savings goals and TFSA room. Every
 * name and figure is invented, so screenshots and sample PDFs made from it are safe to share.
 * Signs the browser in as the new user.
 */
export async function seedPrintablesDemo(page: Page): Promise<{ userId: string; displayName: string }> {
  const email = `e2e-printables-${uniqueStamp()}@example.com`;
  const password = "e2e-password-123";
  const displayName = "Alex Demo";
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hash(password, 12),
      displayName,
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);
  const categories = await prisma.category.findMany({ where: { userId: user.id } });
  const cat = (name: string, kind: CategoryKind = CategoryKind.EXPENSE) =>
    categories.find((c) => c.name === name && c.kind === kind)!.id;
  const chequing = await prisma.account.findFirstOrThrow({ where: { userId: user.id, type: AccountType.CHEQUING } });
  const card = await prisma.account.findFirstOrThrow({ where: { userId: user.id, type: AccountType.CREDIT_CARD } });
  const [savings, tfsa, carLoan] = await Promise.all([
    prisma.account.create({
      data: { userId: user.id, name: "High-Interest Savings", type: AccountType.SAVINGS, countsAsSavings: true },
    }),
    prisma.account.create({ data: { userId: user.id, name: "TFSA", type: AccountType.TFSA } }),
    prisma.account.create({ data: { userId: user.id, name: "Car Loan", type: AccountType.LOAN } }),
  ]);

  // Eleven full months back, plus the first days of this one.
  const rows: Array<{ title: string; category: string; amountCents: number; date: Date; type?: TransactionType; account?: string }> = [];
  for (let m = 11; m >= 0; m--) {
    const wobble = (m * 37) % 9; // the same every run, different every month
    if (m > 0 || new Date().getUTCDate() >= 2) {
      rows.push({ title: "Northwind Payroll", category: "Salary", amountCents: 265_000, date: dayOfMonthsAgo(m, 1), type: TransactionType.INCOME });
      rows.push({ title: "Maple Street Rentals", category: "Rent", amountCents: 175_000, date: dayOfMonthsAgo(m, 1) });
      rows.push({ title: "FreshMart", category: "Groceries", amountCents: 11_640, date: dayOfMonthsAgo(m, 1), account: card.id });
    }
    if (m === 0) continue;
    rows.push({ title: "Northwind Payroll", category: "Salary", amountCents: 265_000, date: dayOfMonthsAgo(m, 15), type: TransactionType.INCOME });
    rows.push({ title: "FreshMart", category: "Groceries", amountCents: 2_610 + wobble * 900, date: dayOfMonthsAgo(m, 4), account: card.id });
    rows.push({ title: "FreshMart", category: "Groceries", amountCents: 16_800 + wobble * 600, date: dayOfMonthsAgo(m, 12), account: card.id });
    rows.push({ title: "Corner Market", category: "Groceries", amountCents: 9_400 + wobble * 300, date: dayOfMonthsAgo(m, 21), account: card.id });
    rows.push({ title: "Lakeside Bistro", category: "Dining", amountCents: 6_800 + wobble * 700, date: dayOfMonthsAgo(m, 9), account: card.id });
    rows.push({ title: "Noodle Bar", category: "Dining", amountCents: 3_200 + wobble * 250, date: dayOfMonthsAgo(m, 23), account: card.id });
    rows.push({ title: "City Hydro", category: "Utilities", amountCents: 9_500 + wobble * 400, date: dayOfMonthsAgo(m, 25) });
    rows.push({ title: "Bright Internet", category: "Utilities", amountCents: 8_500, date: dayOfMonthsAgo(m, 12) });
    rows.push({ title: "Transit Pass", category: "Transport", amountCents: 15_600, date: dayOfMonthsAgo(m, 2), account: card.id });
    rows.push({ title: "StreamFlix", category: "Recurring Services", amountCents: 1_899, date: dayOfMonthsAgo(m, 8), account: card.id });
    rows.push({ title: "Cineplex Downtown", category: "Fun", amountCents: 4_500 + wobble * 500, date: dayOfMonthsAgo(m, 17), account: card.id });
    if (m % 3 === 0) rows.push({ title: "Sunrise Pharmacy", category: "Health", amountCents: 3_850, date: dayOfMonthsAgo(m, 19), account: card.id });
    if (m % 6 === 2) rows.push({ title: "Shield Insurance", category: "Insurance", amountCents: 42_000, date: dayOfMonthsAgo(m, 6) });
  }
  const transfers = await prisma.category.create({
    data: { userId: user.id, name: TRANSFER_CATEGORY_NAME, kind: CategoryKind.TRANSFER },
  });
  // $600 a month into savings, which counts as saved.
  await prisma.transaction.createMany({
    data: Array.from({ length: 11 }, (_, i) => ({
      userId: user.id,
      accountId: chequing.id,
      transferAccountId: savings.id,
      categoryId: transfers.id,
      type: TransactionType.TRANSFER,
      amountCents: 60_000,
      title: "To savings",
      date: dayOfMonthsAgo(i + 1, 16),
    })),
  });
  await prisma.transaction.createMany({
    data: rows.map((r) => ({
      userId: user.id,
      accountId: r.account ?? chequing.id,
      categoryId: cat(r.category, r.type === TransactionType.INCOME ? CategoryKind.INCOME : CategoryKind.EXPENSE),
      type: r.type ?? TransactionType.EXPENSE,
      amountCents: r.amountCents,
      title: r.title,
      date: r.date,
    })),
  });

  // Budgets since half a year ago, rollover on groceries.
  await prisma.budget.createMany({
    data: [
      ["Groceries", 45_000],
      ["Dining", 15_000],
      ["Fun", 10_000],
      ["Transport", 16_000],
      ["Utilities", 20_000],
    ].map(([name, limitCents]) => ({ userId: user.id, categoryId: cat(name as string), periodMonth: ym(6), limitCents: limitCents as number })),
  });
  await prisma.category.update({ where: { id: cat("Groceries") }, data: { rolloverSinceMonth: ym(3) } });

  // Month-end balances over the year.
  const balances: Array<{ accountId: string; start: number; step: number }> = [
    { accountId: chequing.id, start: 420_000, step: 18_000 },
    { accountId: savings.id, start: 600_000, step: 45_000 },
    { accountId: tfsa.id, start: 1_150_000, step: 30_000 },
    { accountId: card.id, start: 140_000, step: -2_000 },
    { accountId: carLoan.id, start: 1_480_000, step: -38_000 },
  ];
  await prisma.accountBalanceSnapshot.createMany({
    data: balances.flatMap((b) =>
      Array.from({ length: 12 }, (_, i) => ({
        userId: user.id,
        accountId: b.accountId,
        date: dayOfMonthsAgo(11 - i, 1),
        balanceCents: b.start + b.step * i,
        source: "MANUAL",
      })),
    ),
  });

  const nextOn = (day: number) => {
    const today = new Date().getUTCDate();
    return dayOfMonthsAgo(day > today ? 0 : -1, day);
  };
  const recurring: Array<[string, string, number, number, TransactionType?]> = [
    ["Rent", "Rent", 175_000, 1],
    ["Bright Internet", "Utilities", 8_500, 12],
    ["City Hydro", "Utilities", 9_800, 25],
    ["StreamFlix", "Recurring Services", 1_899, 8],
    ["Phone plan", "Utilities", 5_500, 20],
    ["Northwind Payroll", "Salary", 265_000, 15, TransactionType.INCOME],
  ];
  const rules = await prisma.recurringTransaction.createManyAndReturn({
    data: recurring.map(([name, category, amountCents, day, type]) => ({
      userId: user.id,
      accountId: chequing.id,
      categoryId: cat(category, type === TransactionType.INCOME ? CategoryKind.INCOME : CategoryKind.EXPENSE),
      type: type ?? TransactionType.EXPENSE,
      name,
      amountCents,
      cadence: RecurringCadence.MONTHLY,
      nextExpectedDate: nextOn(day),
      anchorDay: day,
    })),
  });
  // This month's rent was posted from its rule, so the bill calendar shows it paid.
  const rentRule = rules.find((r) => r.name === "Rent")!;
  await prisma.transaction.updateMany({
    where: { userId: user.id, title: "Maple Street Rentals", date: dayOfMonthsAgo(0, 1) },
    data: { recurringTransactionId: rentRule.id, recurringExpectedDate: dayOfMonthsAgo(0, 1) },
  });

  const nextYear = new Date().getUTCFullYear() + 1;
  await prisma.savingsGoal.createMany({
    data: [
      { userId: user.id, name: "Emergency fund", targetCents: 1_500_000, targetDate: new Date(Date.UTC(nextYear, 11, 1)), accountId: savings.id },
      { userId: user.id, name: "Trip to Lisbon", targetCents: 400_000, targetDate: new Date(Date.UTC(nextYear, 5, 1)), savedCents: 150_000 },
    ],
  });
  await prisma.contributionRoom.create({
    data: { userId: user.id, accountType: AccountType.TFSA, year: new Date().getUTCFullYear(), roomCents: 700_000 },
  });

  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Login" }).click();
  await expectDashboardHome(page);
  return { userId: user.id, displayName };
}
