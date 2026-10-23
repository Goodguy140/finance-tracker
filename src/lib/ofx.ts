/**
 * Reads the transactions out of an OFX or QFX statement (QFX is Quicken's OFX with an extra
 * tag), as a table the CSV import can map like any other file. Client-safe and dependency-free.
 *
 * OFX 1.x is SGML, where a leaf element's closing tag is optional (`<TRNAMT>-12.34` then a
 * newline); OFX 2.x is XML. Reading each `<STMTTRN>` block and taking every leaf value up to
 * the next `<` handles both.
 *
 * OFX amounts are signed from the account's point of view: negative is money out. The import
 * is told so (`OFX_AMOUNT_SIGN`) rather than the amounts being flipped here, so the preview
 * shows the file's own numbers.
 */

export const OFX_HEADERS = ["Date", "Description", "Memo", "Amount", "Type", "Id"] as const;
export const OFX_AMOUNT_SIGN = "spending-negative" as const;

export function looksLikeOfx(fileName: string, text: string): boolean {
  return /\.(ofx|qfx)$/i.test(fileName) || /<OFX>/i.test(text.slice(0, 4096));
}

function leaf(block: string, tag: string): string {
  const match = new RegExp(`<${tag}>([^<\\r\\n]*)`, "i").exec(block);
  return decodeEntities(match?.[1]?.trim() ?? "");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&");
}

/** `20261014120000.000[-5:EST]` → `2026-10-14`; the day the bank booked it, as written. */
export function ofxDate(raw: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(raw.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : raw;
}

export function parseOfx(text: string): { headers: string[]; rows: Array<Record<string, string>> } {
  const rows: Array<Record<string, string>> = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  for (const chunk of blocks) {
    const block = chunk.split(/<\/STMTTRN>/i)[0];
    const amount = leaf(block, "TRNAMT");
    if (!amount) continue;
    rows.push({
      Date: ofxDate(leaf(block, "DTPOSTED") || leaf(block, "DTUSER")),
      Description: leaf(block, "NAME") || leaf(block, "PAYEE") || leaf(block, "MEMO"),
      Memo: leaf(block, "MEMO"),
      Amount: amount,
      Type: leaf(block, "TRNTYPE"),
      Id: leaf(block, "FITID"),
    });
  }
  return { headers: [...OFX_HEADERS], rows };
}
