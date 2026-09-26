import type { InsightTx } from "./types";

let seq = 0;

/** A transaction with sensible defaults; `date` is `YYYY-MM-DD`. */
export function tx(date: string, title: string, amountCents: number, overrides: Partial<InsightTx> = {}): InsightTx {
  seq += 1;
  return {
    id: `tx${seq}`,
    type: "EXPENSE",
    amountCents,
    date: new Date(`${date}T00:00:00.000Z`),
    title,
    note: null,
    categoryId: "cat-fun",
    categoryName: "Fun",
    accountId: "acct-card",
    recurringTransactionId: null,
    splits: [],
    ...overrides,
  };
}

export const NOW = new Date("2026-09-25T12:00:00.000Z");
