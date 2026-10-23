import type { PrismaClient, TransactionType } from "@prisma/client";
import { toCsv } from "@/lib/csv";
import { ymdFromDateUtc } from "@/lib/date-only";

/**
 * Every logged transaction as a spreadsheet: Settings → Backup and restore → "Export
 * transactions (CSV)". One row per entry; a split lists its parts in one cell.
 *
 * Amounts go in an "Out" or an "In" column, always positive, rather than one signed column:
 * the CSV writer defuses a leading "-" as a possible formula, which would turn every expense
 * into text in Excel. A refund (a negative expense) is money in.
 */

export const TRANSACTIONS_CSV_HEADER = [
  "Date",
  "Posted date",
  "Type",
  "Title",
  "Out",
  "In",
  "Currency",
  "Category",
  "Account",
  "Other account",
  "Split",
  "Owed to you",
  "Tags",
  "Note",
  "Verified",
] as const;

export type CsvTransaction = {
  date: Date;
  postedDate: Date | null;
  type: TransactionType;
  title: string | null;
  amountCents: number;
  categoryName: string;
  accountName: string | null;
  accountCurrency: string | null;
  transferAccountName: string | null;
  splitParts: { categoryName: string; amountCents: number }[];
  owedCents: number;
  tagNames: string[];
  note: string | null;
  verifiedBy: string | null;
};

const money = (cents: number) => (Math.abs(cents) / 100).toFixed(2);

/** Money into the user's accounts is positive: income, refunds, and transfers arriving. */
export function signedInflowCents(tx: Pick<CsvTransaction, "type" | "amountCents">): number {
  if (tx.type === "INCOME") return tx.amountCents;
  // An expense or a transfer's positive amount left the account.
  return -tx.amountCents;
}

const TYPE_LABEL: Record<TransactionType, string> = { EXPENSE: "Expense", INCOME: "Income", TRANSFER: "Transfer" };

export function transactionsCsv(rows: readonly CsvTransaction[], homeCurrency: string): string {
  return toCsv(
    TRANSACTIONS_CSV_HEADER,
    rows.map((tx) => {
      const inflow = signedInflowCents(tx);
      return [
        ymdFromDateUtc(tx.date),
        tx.postedDate ? ymdFromDateUtc(tx.postedDate) : "",
        TYPE_LABEL[tx.type],
        tx.title ?? "",
        inflow < 0 ? money(inflow) : "",
        inflow > 0 ? money(inflow) : "",
        tx.accountCurrency ?? homeCurrency,
        tx.categoryName,
        tx.accountName ?? "",
        tx.transferAccountName ?? "",
        tx.splitParts.map((p) => `${p.categoryName} ${money(p.amountCents)}`).join("; "),
        tx.owedCents ? money(tx.owedCents) : "",
        tx.tagNames.join("; "),
        tx.note ?? "",
        tx.verifiedBy ?? "",
      ];
    }),
  );
}

/** The user's transactions dated within [from, to) (either end optional), oldest first. */
export async function loadCsvTransactions(
  db: PrismaClient,
  userId: string,
  range: { from?: Date; to?: Date } = {},
): Promise<CsvTransaction[]> {
  const rows = await db.transaction.findMany({
    where: {
      userId,
      ...(range.from || range.to ? { date: { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lt: range.to } : {}) } } : {}),
    },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    include: {
      category: { select: { name: true } },
      account: { select: { name: true, currency: true } },
      transferAccount: { select: { name: true } },
      splitParts: { include: { category: { select: { name: true } } } },
      owedShares: { select: { amountCents: true } },
      tags: { include: { tag: { select: { name: true } } } },
      verification: { select: { institutionName: true } },
    },
  });
  return rows.map((tx) => ({
    date: tx.date,
    postedDate: tx.postedDate,
    type: tx.type,
    title: tx.title,
    amountCents: tx.amountCents,
    categoryName: tx.category.name,
    accountName: tx.account?.name ?? null,
    accountCurrency: tx.account?.currency ?? null,
    transferAccountName: tx.transferAccount?.name ?? null,
    splitParts: tx.splitParts.map((p) => ({ categoryName: p.category.name, amountCents: p.amountCents })),
    owedCents: tx.owedShares.reduce((sum, s) => sum + s.amountCents, 0),
    tagNames: tx.tags.map((t) => t.tag.name).sort((a, b) => a.localeCompare(b)),
    note: tx.note,
    verifiedBy: tx.verification ? (tx.verification.institutionName ?? "Bank") : null,
  }));
}
