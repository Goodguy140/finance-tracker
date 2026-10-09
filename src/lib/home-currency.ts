import type { Prisma } from "@prisma/client";
import { getCountryConfig } from "@/lib/country-config";
import { formatCurrency } from "@/lib/money";

/**
 * Amounts are stored as bare cents in their account's currency, and there is no conversion.
 * Every total (spending, income, budgets, reports, the score) is in the user's home currency,
 * so entries on an account in any other currency are left out of them and shown on their own.
 */
export function homeCurrencyOf(countryCode: string | null | undefined): string {
  return getCountryConfig(countryCode).defaultCurrency;
}

/**
 * Narrows a transaction query to entries in `currency`. An entry with no account (its account
 * was removed) has nothing saying otherwise and counts as home currency.
 *
 * Spread it into a `where` that has no `OR` of its own, or put it in an `AND` list.
 */
export function inCurrencyWhere(currency: string): Prisma.TransactionWhereInput {
  return { OR: [{ accountId: null }, { account: { currency } }] };
}

/** An entry's currency when it is not the home one; null when it counts toward the totals. */
export function foreignCurrencyOf(
  account: { currency: string } | null | undefined,
  homeCurrency: string,
): string | null {
  if (!account || account.currency === homeCurrency) return null;
  return account.currency;
}

export type OtherCurrencyTotal = { currency: string; expenseCents: number; incomeCents: number };

/** Spending and income per non-home currency, for the note under a total that leaves them out. */
export function sumOtherCurrencies(
  rows: { type: string; amountCents: number; currency: string | null }[],
): OtherCurrencyTotal[] {
  const byCurrency = new Map<string, OtherCurrencyTotal>();
  for (const row of rows) {
    if (!row.currency) continue;
    if (row.type !== "EXPENSE" && row.type !== "INCOME") continue;
    const total = byCurrency.get(row.currency) ?? { currency: row.currency, expenseCents: 0, incomeCents: 0 };
    if (row.type === "EXPENSE") total.expenseCents += row.amountCents;
    else total.incomeCents += row.amountCents;
    byCurrency.set(row.currency, total);
  }
  return [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

/**
 * "US$40.00 in USD" for each currency with any of `kind`, joined; null when there is none.
 * The code is spelled out because a symbol alone ($) reads as the home currency.
 */
export function describeOtherCurrencies(totals: OtherCurrencyTotal[], kind: "expense" | "income"): string | null {
  const parts = totals
    .map((t) => ({ currency: t.currency, cents: kind === "expense" ? t.expenseCents : t.incomeCents }))
    .filter((t) => t.cents !== 0)
    .map((t) => `${formatCurrency(t.cents, t.currency)} in ${t.currency}`);
  return parts.length ? parts.join(", ") : null;
}
