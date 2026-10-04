/**
 * Transfers: money moving between the user's own accounts — paying a credit card from
 * chequing, moving savings, an ATM withdrawal into cash.
 *
 * They are their own transaction type because they are neither spending nor income. Booked
 * as an expense on one side and income on the other (as Plaid sync used to), paying a card
 * counted the same purchases twice: once when they were charged, again when the card was
 * paid. Everything that totals spending or income asks for EXPENSE or INCOME by name, so a
 * TRANSFER row drops out of every figure without each one having to remember to skip it.
 *
 * Pure and client-safe: the log's buttons and the review queue use the same conversions as
 * the server actions.
 */

export type TransactionKind = "EXPENSE" | "INCOME" | "TRANSFER";

/**
 * The amount as money leaving the row's account: positive out, negative in.
 *
 * Expenses and transfers are already stored that way (a refund is a negative expense);
 * income is stored positive, so it flips. This is also Plaid's sign, which is what lets a
 * bank row and a transaction of a different type be compared at all.
 */
export function outflowCents(type: TransactionKind, amountCents: number): number {
  return type === "INCOME" ? -amountCents : amountCents;
}

/** The `amountCents` a row of type `from` carries once it is booked as `to`. */
export function convertAmountCents(from: TransactionKind, amountCents: number, to: TransactionKind): number {
  const outflow = outflowCents(from, amountCents);
  return to === "INCOME" ? -outflow : outflow;
}

/**
 * What a transfer becomes when the user says it is not one: money that left the account is
 * spending, money that arrived is income. A refund (money in, but a negative expense) is the
 * one case this gets wrong, and the entry can be edited afterwards like any other.
 */
export function untransferredType(amountCents: number): "EXPENSE" | "INCOME" {
  return amountCents < 0 ? "INCOME" : "EXPENSE";
}

/** The name of the category created for a user's first transfer. */
export const TRANSFER_CATEGORY_NAME = "Transfers";
