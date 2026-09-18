/**
 * RFC 4180-style CSV parsing for statement imports.
 *
 * The previous parser split the text on newlines *before* looking at quotes, so a quoted
 * cell containing a line break (common in bank memo fields) was cut into two rows. This is
 * a single pass over the whole text: a newline inside quotes is part of the cell, `""`
 * inside quotes is a literal quote, and CR, LF and CRLF all end a record.
 */

export type ParsedCsv = { headers: string[]; rows: Record<string, string>[] };

/** Splits `text` into records of trimmed cells. Blank records (whitespace only) are dropped. */
export function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let cells: string[] = [];
  let current = "";
  let inQuotes = false;

  const endCell = () => {
    cells.push(current.trim());
    current = "";
  };
  const endRecord = () => {
    endCell();
    if (cells.some((cell) => cell.length > 0)) records.push(cells);
    cells = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ",") {
      endCell();
      continue;
    }
    if (char === "\r") {
      if (text[i + 1] === "\n") i += 1;
      endRecord();
      continue;
    }
    if (char === "\n") {
      endRecord();
      continue;
    }
    current += char;
  }
  endRecord();
  return records;
}

/** One line of CSV into cells. Kept for callers that already have a single record. */
export function parseCsvLine(line: string): string[] {
  return parseCsvRecords(line)[0] ?? [""];
}

/** First record is the header row; every later record becomes a `{ header: cell }` object. */
export function parseCsvText(csvText: string): ParsedCsv {
  const records = parseCsvRecords(csvText);
  if (records.length < 2) return { headers: [], rows: [] };

  const headers = records[0];
  const rows = records.slice(1).map((cells) =>
    headers.reduce<Record<string, string>>((acc, header, index) => {
      acc[header] = cells[index] ?? "";
      return acc;
    }, {}),
  );
  return { headers, rows };
}

/**
 * Characters that make a spreadsheet treat a cell as a formula rather than as text. A cell
 * beginning with one of these is prefixed with an apostrophe when written out.
 *
 * This matters because exported rows can contain attacker-influenced values — an attempted
 * email address, a user agent — and an export exists to be opened in Excel by an
 * administrator. Without the prefix, `=HYPERLINK(...)` typed into a sign-up form runs on
 * their machine when they review the log. Tab and CR are included because Excel strips
 * leading whitespace before deciding, so " =cmd" is still a formula.
 */
const FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw = String(value);
  const defused = FORMULA_PREFIXES.some((p) => raw.startsWith(p)) ? `'${raw}` : raw;
  // Quote whenever the value could otherwise break the row or field structure; doubling an
  // embedded quote is how RFC 4180 escapes it.
  return /[",\n\r]/.test(defused) ? `"${defused.replaceAll('"', '""')}"` : defused;
}

export function toCsvRow(cells: readonly unknown[]): string {
  return cells.map(escapeCsvCell).join(",");
}

/** CRLF line endings, per RFC 4180 — Excel is the target and it is the fussiest reader. */
export function toCsv(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return [toCsvRow(header), ...rows.map(toCsvRow)].join("\r\n");
}
