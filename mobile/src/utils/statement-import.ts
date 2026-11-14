import type { SharedItem } from '@/utils/shared-receipt';

/**
 * A bank statement shared to Finances (CSV, or OFX/QFX), imported as the website's "Import
 * transactions from a file" does: the server reads the file and books it (`/api/v1/imports`), so
 * a file reads the same in both places. What is here only gets the file there and shows the
 * person what their choices will do before anything is booked.
 */

/** The server reads at most 5 MB of text (`MAX_STATEMENT_CHARS`); a file's bytes are never fewer than its characters. */
export const MAX_STATEMENT_BYTES = 5 * 1024 * 1024;

export type StatementFormat = 'csv' | 'ofx';

export type SharedStatement = { uri: string; fileName: string; sizeBytes: number | null; format: StatementFormat };

const CSV_TYPES = new Set(['text/csv', 'text/comma-separated-values', 'application/csv']);
const OFX_TYPES = new Set(['application/x-ofx', 'application/ofx', 'application/vnd.intu.qfx', 'application/x-qfx']);

function extension(name: string | null | undefined): string {
  return /\.([a-z0-9]+)$/i.exec(name?.trim() ?? '')?.[1]?.toLowerCase() ?? '';
}

/** Which kind of statement a shared file is, by its type or its name; null when it is not one. */
export function statementFormat(item: SharedItem): StatementFormat | null {
  const mime = item.contentMimeType?.toLowerCase().split(';')[0]?.trim() ?? '';
  const ext = extension(item.originalName) || extension(item.contentUri);
  if (ext === 'csv' || CSV_TYPES.has(mime)) return 'csv';
  if (ext === 'ofx' || ext === 'qfx' || OFX_TYPES.has(mime)) return 'ofx';
  return null;
}

/** The first shared file that is a statement, or why it can't be imported; null when none is a statement. */
export function statementFromShares(items: readonly SharedItem[]): { statement: SharedStatement } | { error: string } | null {
  for (const item of items) {
    const format = statementFormat(item);
    if (!format) continue;
    if (!item.contentUri) return { error: 'Couldn’t open the statement that was shared. Share it again.' };
    if (item.contentSize && item.contentSize > MAX_STATEMENT_BYTES) {
      return { error: 'That statement is over 5 MB. Split it into smaller statements, or import it on the website.' };
    }
    const fileName = item.originalName?.trim() || (format === 'csv' ? 'statement.csv' : 'statement.ofx');
    return { statement: { uri: item.contentUri, fileName, sizeBytes: item.contentSize ?? null, format } };
  }
  return null;
}

/** A column of the file, read into one field of each entry; the website form's choices. */
export type ImportField = 'amount' | 'amountIn' | 'date' | 'postedDate' | 'title' | 'note' | 'accountName' | 'categoryName';

/** Field → the file's column that fills it. */
export type ColumnMapping = Partial<Record<ImportField, string>>;

export const IMPORT_FIELDS: readonly { field: ImportField; label: string; note?: string }[] = [
  { field: 'date', label: 'Date', note: 'Rows without a date that can be read are left out.' },
  { field: 'title', label: 'Title' },
  { field: 'amount', label: 'Amount', note: 'Needed. With Debit and Credit columns, this is Debit.' },
  { field: 'amountIn', label: 'Money In', note: 'A separate Credit column, if the file has one.' },
  { field: 'postedDate', label: 'Posted Date' },
  { field: 'note', label: 'Note' },
  { field: 'accountName', label: 'Account Name', note: 'Rows naming an account you have go there; the rest go to the account above.' },
  { field: 'categoryName', label: 'Category Name', note: 'A category the file names that you don’t have yet is made.' },
];

/** `mapping` with `field` read from `column` (or from no column), and that column taken from any other field. */
export function setColumn(mapping: ColumnMapping, field: ImportField, column: string | null): ColumnMapping {
  const next: ColumnMapping = {};
  for (const [f, c] of Object.entries(mapping) as [ImportField, string][]) {
    if (f !== field && c && c !== column) next[f] = c;
  }
  if (column) next[field] = column;
  return next;
}

export type AmountSign = 'spending-positive' | 'spending-negative';
export type MoneyIn = 'refund' | 'income';

/** What `POST /api/v1/imports/preview` answers. */
export type StatementPreview = {
  format: StatementFormat;
  headers: string[];
  rowCount: number;
  sample: Record<string, string>[];
  mapping: ColumnMapping;
  amountSign: AmountSign;
  /** OFX says which way its amounts run, so there is nothing to ask. */
  signFixed: boolean;
};

/** What `POST /api/v1/imports` answers: what it booked, and each row it left out and why. */
export type StatementImportSummary = {
  imported: number;
  income: number;
  duplicates: { row: number; title: string | null; date: string; amountCents: number }[];
  unreadableDates: { row: number; title: string | null; value: string; field: 'date' | 'postedDate' }[];
  unreadableAmounts: number;
};

/**
 * An amount as a bank prints it, in dollars: "$1,234.50", "(12.34)", "12.34-", "−5". Null for none
 * or zero. The server's `parseStatementAmount` (src/lib/money.ts), copied for the preview only:
 * the server reads the file again when it books it.
 */
export function readStatementAmount(raw: string): number | null {
  let s = raw.trim().replace(/[$\s 　]/g, '');
  if (!s) return null;
  s = s.replace(/−/g, '-');
  let sign = 1;
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0)).replace(/．/g, '.');
  s = s.replace(/,/g, '');
  if (s.endsWith('-')) {
    sign *= -1;
    s = s.slice(0, -1).trim();
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n === 0) return null;
  return sign * n;
}

/** Money out of the account on this row, negative for money in; the server's `statementOutflow`. */
export function rowOutflow(row: Record<string, string>, mapping: ColumnMapping, sign: AmountSign): number | null {
  const read = (column: string | undefined) => {
    const raw = column ? row[column]?.trim() : '';
    return raw ? readStatementAmount(raw) : null;
  };
  const out = read(mapping.amount);
  if (mapping.amountIn) {
    const into = read(mapping.amountIn);
    if (out === null && into === null) return null;
    const net = Math.abs(out ?? 0) - Math.abs(into ?? 0);
    return net === 0 ? null : net;
  }
  if (out === null) return null;
  return sign === 'spending-negative' ? -out : out;
}

export type SampleLine = {
  date: string | null;
  title: string | null;
  /** Cents, never negative; `kind` says which way. */
  cents: number | null;
  kind: 'spending' | 'refund' | 'income' | 'skipped';
};

/** How the file's first rows will be booked with these choices, so a wrong sign shows before importing. */
export function sampleLines(preview: StatementPreview, mapping: ColumnMapping, sign: AmountSign, moneyIn: MoneyIn): SampleLine[] {
  const effectiveSign = preview.signFixed ? preview.amountSign : sign;
  return preview.sample.map((row) => {
    const cell = (column: string | undefined) => (column ? row[column]?.trim() || null : null);
    const out = mapping.amount ? rowOutflow(row, mapping, effectiveSign) : null;
    const base = { date: cell(mapping.date), title: cell(mapping.title) };
    if (out === null) return { ...base, cents: null, kind: 'skipped' };
    const cents = Math.round(Math.abs(out) * 100);
    if (out > 0) return { ...base, cents, kind: 'spending' };
    return { ...base, cents, kind: moneyIn === 'income' ? 'income' : 'refund' };
  });
}

export type ImportChoices = {
  mapping: ColumnMapping;
  accountId: string | null;
  categoryId: string | null;
  amountSign: AmountSign;
  moneyIn: MoneyIn;
  incomeCategoryId: string | null;
};

/** The body for `POST /api/v1/imports`, or what is still missing. */
export function importBody(
  statement: Pick<SharedStatement, 'fileName' | 'format'>,
  text: string,
  choices: ImportChoices,
): { body: Record<string, unknown> } | { error: string } {
  if (!choices.accountId) return { error: 'Choose the account these transactions are on.' };
  if (!choices.categoryId) return { error: 'Choose a category for spending.' };
  if (!choices.mapping.amount) return { error: 'Choose the column with the amount.' };
  if (choices.moneyIn === 'income' && !choices.incomeCategoryId) return { error: 'Choose a category for money coming in.' };
  const body: Record<string, unknown> = {
    fileName: statement.fileName.slice(0, 255),
    text,
    mapping: choices.mapping,
    accountId: choices.accountId,
    categoryId: choices.categoryId,
    moneyIn: choices.moneyIn,
  };
  // OFX amounts are signed by the file; with a Credit column each column is read as a size.
  if (statement.format === 'csv' && !choices.mapping.amountIn) body.amountSign = choices.amountSign;
  if (choices.moneyIn === 'income') body.incomeCategoryId = choices.incomeCategoryId;
  return { body };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The summary as the website's import dialog words it: a heading, then one line per kind of row left out. */
export function summaryText(summary: StatementImportSummary): { heading: string; lines: string[] } {
  const income = summary.income ?? 0;
  const expenses = summary.imported - income;
  const heading = `Imported ${plural(expenses, 'expense', 'expenses')}${income > 0 ? ` and ${plural(income, 'income entry', 'income entries')}` : ''}`;
  const lines: string[] = [];
  if (summary.duplicates.length > 0) lines.push(`${summary.duplicates.length} skipped: already in your log.`);
  if (summary.unreadableDates.length > 0) lines.push(`${summary.unreadableDates.length} skipped: the date could not be read.`);
  if (summary.unreadableAmounts > 0) {
    lines.push(`${plural(summary.unreadableAmounts, 'row was', 'rows were')} skipped for a missing or unreadable amount.`);
  }
  if (lines.length === 0) lines.push('Every row in the file was imported.');
  return { heading, lines };
}
