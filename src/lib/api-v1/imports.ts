import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { guessColumnMapping, type CsvImportSummary, type ImportField } from "@/lib/csv-import";
import { parseCsvText } from "@/lib/csv";
import { looksLikeOfx, OFX_AMOUNT_SIGN, parseOfx } from "@/lib/ofx";
import { importStatement, StatementImportError } from "@/lib/statement-import";
import { expenseCsvImportSchema, MAX_CSV_IMPORT_ROWS } from "@/lib/validation";

/**
 * A bank statement shared to the phone (CSV, or OFX/QFX), imported as the website's "Import
 * transactions from a file" does. The phone sends the file's text; the server reads it with the
 * website's own readers, so a file reads the same in both places.
 *
 * `POST /api/v1/imports/preview` reads the file and guesses which column is which, as the website's
 * form does on choosing a file. `POST /api/v1/imports` books it with the person's choices through
 * `importStatement`, the website's importer: rules apply, rows already in the log are skipped, and
 * everything waits in Needs review.
 */

/** About the largest statement the website's 5,000-row limit lets through, with room to spare. */
export const MAX_STATEMENT_CHARS = 5 * 1024 * 1024;

const FIELDS = ["amount", "amountIn", "date", "postedDate", "title", "note", "accountName", "categoryName"] as const satisfies readonly ImportField[];

type Failure = { ok: false; status: 400 | 404 | 413; error: string };

type ReadStatement = { ok: true; format: "csv" | "ofx"; headers: string[]; rows: Record<string, string>[] };

function readStatement(fileName: unknown, text: unknown): ReadStatement | Failure {
  if (typeof text !== "string" || !text.trim()) return { ok: false, status: 400, error: "The file is empty." };
  if (text.length > MAX_STATEMENT_CHARS) return { ok: false, status: 413, error: "That file is too large to import. Split it into smaller statements." };
  const name = typeof fileName === "string" ? fileName : "";
  const ofx = looksLikeOfx(name, text);
  const parsed = ofx ? parseOfx(text) : parseCsvText(text);
  if (parsed.headers.length === 0 || parsed.rows.length === 0) {
    return {
      ok: false,
      status: 400,
      error: ofx ? "No transactions were found in this statement." : "The file needs a header row and at least one row of transactions.",
    };
  }
  if (parsed.rows.length > MAX_CSV_IMPORT_ROWS) {
    return { ok: false, status: 413, error: `Import at most ${MAX_CSV_IMPORT_ROWS.toLocaleString("en-US")} rows at a time. Split the statement.` };
  }
  return { ok: true, format: ofx ? "ofx" : "csv", headers: parsed.headers, rows: parsed.rows };
}

const previewSchema = z.object({ fileName: z.string().max(255).optional(), text: z.string() }).strict();

/** `POST /api/v1/imports/preview`: what is in the file, and the website form's first guess at its columns. */
export function previewStatementFromApi(body: unknown) {
  const parsed = previewSchema.safeParse(body);
  if (!parsed.success) return { ok: false as const, status: 400 as const, error: "Send the file's name and text." };
  const read = readStatement(parsed.data.fileName, parsed.data.text);
  if (!read.ok) return read;
  const guessed = guessColumnMapping(read.headers, read.format === "ofx");
  const mapping: Partial<Record<ImportField, string>> = {};
  for (const [header, field] of Object.entries(guessed)) if (field) mapping[field] = header;
  return {
    ok: true as const,
    preview: {
      format: read.format,
      headers: read.headers,
      rowCount: read.rows.length,
      /** The first rows as the file has them, for checking the columns. */
      sample: read.rows.slice(0, 5),
      /** Field → the column guessed for it. */
      mapping,
      /** OFX amounts are signed from the account's side; a CSV is taken as spending positive until told otherwise. */
      amountSign: read.format === "ofx" ? OFX_AMOUNT_SIGN : ("spending-positive" as const),
      /** OFX says which way amounts run, so the phone does not ask. */
      signFixed: read.format === "ofx",
    },
  };
}

const importSchema = z
  .object({
    fileName: z.string().max(255).optional(),
    text: z.string(),
    mapping: z
      .object({
        amount: z.string().min(1).optional(),
        amountIn: z.string().min(1).optional(),
        date: z.string().min(1).optional(),
        postedDate: z.string().min(1).optional(),
        title: z.string().min(1).optional(),
        note: z.string().min(1).optional(),
        accountName: z.string().min(1).optional(),
        categoryName: z.string().min(1).optional(),
      })
      .strict(),
    accountId: z.string().min(1),
    categoryId: z.string().min(1),
    amountSign: z.enum(["spending-positive", "spending-negative"]).optional(),
    moneyIn: z.enum(["refund", "income"]).optional(),
    incomeCategoryId: z.string().min(1).optional(),
  })
  .strict();

/** `POST /api/v1/imports`: books the statement with the columns and defaults the person chose. */
export async function importStatementFromApi(
  db: PrismaClient,
  userId: string,
  body: unknown,
): Promise<{ ok: true; summary: CsvImportSummary } | Failure> {
  const parsed = importSchema.safeParse(body);
  if (!parsed.success) return { ok: false, status: 400, error: "Choose the account, category and the column with the amount." };
  const input = parsed.data;
  if (!input.mapping.amount) return { ok: false, status: 400, error: "Choose the column with the amount." };
  const read = readStatement(input.fileName, input.text);
  if (!read.ok) return read;

  const chosen = FIELDS.flatMap((field) => (input.mapping[field] ? [[field, input.mapping[field]] as const] : []));
  for (const [, header] of chosen) {
    if (!read.headers.includes(header)) return { ok: false, status: 400, error: `The file has no column called “${header}”.` };
  }
  // The website's own check: one field per column.
  const fieldSelections = read.headers.map((header) => chosen.find(([, h]) => h === header)?.[0] ?? "");
  if (fieldSelections.filter(Boolean).length !== chosen.length) return { ok: false, status: 400, error: "Each column can fill only one field." };

  const owned = await db.account.findFirst({ where: { id: input.accountId, userId, archived: false }, select: { id: true } });
  if (!owned) return { ok: false, status: 404, error: "That account was not found." };

  const payload = expenseCsvImportSchema.safeParse({
    rows: read.rows,
    mapping: { ...input.mapping, amount: input.mapping.amount },
    manualValues: {},
    defaults: { accountId: input.accountId, categoryId: input.categoryId, incomeCategoryId: input.incomeCategoryId },
    amountSign: read.format === "ofx" ? OFX_AMOUNT_SIGN : input.amountSign,
    moneyIn: input.moneyIn,
    fieldSelections,
  });
  if (!payload.success) return { ok: false, status: 400, error: payload.error.issues[0]?.message ?? "The import could not be read." };
  try {
    return { ok: true, summary: await importStatement(db, userId, payload.data) };
  } catch (err) {
    // A category that is not the person's, or money in as income with no category.
    if (err instanceof StatementImportError) return { ok: false, status: 400, error: err.message };
    throw err;
  }
}
