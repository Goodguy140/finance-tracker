/**
 * What a statement import did with each row, returned to the import form so it can say so.
 *
 * Imports used to drop rows they could not use without a word, and booked a date they could
 * not read as today, which put the expense in the wrong month. Rows like that are now left
 * out and listed here instead. Client-safe: no server-only imports.
 */

export type CsvImportSkippedRow = {
  /** 1-based position among the file's data rows (the header row is not counted). */
  row: number;
  title: string | null;
  /** The cell as it appeared in the file. */
  value: string;
};

export type CsvImportDuplicateRow = {
  row: number;
  title: string | null;
  date: string;
  amountCents: number;
};

export type CsvImportSummary = {
  ok: true;
  imported: number;
  /** Rows with a transaction or posted date that could not be read, or no date at all. */
  unreadableDates: (CsvImportSkippedRow & { field: "date" | "postedDate" })[];
  /** Rows already in the log: same date, amount and title as an existing expense. */
  duplicates: CsvImportDuplicateRow[];
  /** Rows with no amount, or one that could not be read. */
  unreadableAmounts: number;
};

export function isCsvImportSummary(value: unknown): value is CsvImportSummary {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { ok?: unknown }).ok === true &&
    typeof (value as { imported?: unknown }).imported === "number"
  );
}

/** YYYY-MM-DD in UTC, the form transaction dates are stored and compared in. */
export function utcYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The identity of an expense for duplicate detection: account, day, amount and title
 * (case-insensitive).
 *
 * The account is part of it because the same coffee on the same day can honestly appear on
 * two cards, and importing the second card's statement must not drop it as a copy of the
 * first. A row with no account only matches another row with no account.
 */
export function duplicateKey(
  accountId: string | null | undefined,
  date: Date,
  amountCents: number,
  title: string | null | undefined,
): string {
  return `${accountId ?? ""}|${utcYmd(date)}|${amountCents}|${(title ?? "").trim().toLowerCase()}`;
}

/**
 * Counts existing expenses per key, and lets each one absorb a single imported row.
 *
 * A count rather than a set: a statement can honestly hold two identical rows (two coffees
 * on one day). Re-importing it should skip both, and importing it the first time should keep
 * both, so an existing expense matches at most one row.
 */
export class DuplicateMatcher {
  private readonly remaining = new Map<string, number>();

  constructor(
    existing: Iterable<{ accountId: string | null; date: Date; amountCents: number; title: string | null }>,
  ) {
    for (const row of existing) {
      const key = duplicateKey(row.accountId, row.date, row.amountCents, row.title);
      this.remaining.set(key, (this.remaining.get(key) ?? 0) + 1);
    }
  }

/** True when an unclaimed existing expense matches; that expense is then used up. */
  claim(
    accountId: string | null | undefined,
    date: Date,
    amountCents: number,
    title: string | null | undefined,
  ): boolean {
    const key = duplicateKey(accountId, date, amountCents, title);
    const left = this.remaining.get(key) ?? 0;
    if (left === 0) return false;
    this.remaining.set(key, left - 1);
    return true;
  }
}
