import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

/** A statement shared to the phone, read and booked by the website's importer, against a real database. */

const dir = mkdtempSync(join(tmpdir(), "api-imports-"));
const url = `file:${join(dir, "imports.db")}`;
let db: PrismaClient;
let api: typeof import("./imports");

beforeAll(async () => {
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  api = await import("./imports");
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const CSV = `Transaction Date,Description,Debit,Credit
2026-10-03,LOBLAWS #12,42.10,
2026-10-04,REFUND AMAZON,,15.00
2026-10-05,PAYROLL,,2500.00
`;

const OFX = `OFXHEADER:100
DATA:OFXSGML

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261014<TRNAMT>-4.50<FITID>A1<NAME>COFFEE</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

let seq = 0;
async function person() {
  seq += 1;
  const user = await db.user.create({ data: { email: `import${seq}@example.test`, displayName: "Sam" } });
  const userId = user.id;
  const [chequing, other, groceries, pay] = await Promise.all([
    db.account.create({ data: { userId, name: "Chequing", type: "CHEQUING" } }),
    db.account.create({ data: { userId, name: "Visa", type: "CREDIT_CARD" } }),
    db.category.create({ data: { userId, name: "Groceries", kind: "EXPENSE" } }),
    db.category.create({ data: { userId, name: "Pay", kind: "INCOME" } }),
  ]);
  return { userId, chequing, other, groceries, pay };
}

describe("importing a statement from the phone", () => {
  it("reads a file as the website's form does and guesses its columns", () => {
    const csv = api.previewStatementFromApi({ fileName: "october.csv", text: CSV });
    expect(csv).toMatchObject({
      ok: true,
      preview: {
        format: "csv",
        rowCount: 3,
        mapping: { date: "Transaction Date", title: "Description", amount: "Debit", amountIn: "Credit" },
        signFixed: false,
      },
    });
    const ofx = api.previewStatementFromApi({ fileName: "statement.qfx", text: OFX });
    expect(ofx).toMatchObject({ ok: true, preview: { format: "ofx", rowCount: 1, amountSign: "spending-negative", signFixed: true } });
    expect(api.previewStatementFromApi({ fileName: "empty.csv", text: "Date,Amount\n" })).toMatchObject({ ok: false, status: 400 });
  });

  it("books the rows on the chosen account in Needs review, money in as income when asked, and nothing twice", async () => {
    const { userId, chequing, groceries, pay } = await person();
    const body = {
      fileName: "october.csv",
      text: CSV,
      mapping: { date: "Transaction Date", title: "Description", amount: "Debit", amountIn: "Credit" },
      accountId: chequing.id,
      categoryId: groceries.id,
      moneyIn: "income",
      incomeCategoryId: pay.id,
    };
    const first = await api.importStatementFromApi(db, userId, body);
    expect(first).toMatchObject({ ok: true, summary: { imported: 3, income: 2, duplicates: [] } });
    const booked = await db.transaction.findMany({ where: { userId }, orderBy: { date: "asc" } });
    expect(booked.map((t) => [t.title, t.type, t.amountCents, t.accountId, t.needsReview])).toEqual([
      ["LOBLAWS #12", "EXPENSE", 4210, chequing.id, true],
      ["REFUND AMAZON", "INCOME", 1500, chequing.id, true],
      ["PAYROLL", "INCOME", 250000, chequing.id, true],
    ]);

    const again = await api.importStatementFromApi(db, userId, body);
    expect(again).toMatchObject({ ok: true, summary: { imported: 0 } });
    if (again.ok) expect(again.summary.duplicates).toHaveLength(3);
    expect(await db.transaction.count({ where: { userId } })).toBe(3);
  });

  it("refuses columns the file lacks, one column for two fields, and another person's account or category", async () => {
    const mine = await person();
    const theirs = await person();
    const base = { fileName: "october.csv", text: CSV, accountId: mine.chequing.id, categoryId: mine.groceries.id };
    const map = { date: "Transaction Date", title: "Description", amount: "Debit" };
    expect(await api.importStatementFromApi(db, mine.userId, { ...base, mapping: { ...map, amount: "Amount" } })).toMatchObject({ ok: false, status: 400 });
    expect(await api.importStatementFromApi(db, mine.userId, { ...base, mapping: { ...map, note: "Description" } })).toMatchObject({ ok: false, status: 400 });
    expect(await api.importStatementFromApi(db, mine.userId, { ...base, mapping: map, accountId: theirs.chequing.id })).toMatchObject({ ok: false, status: 404 });
    expect(await api.importStatementFromApi(db, mine.userId, { ...base, mapping: map, categoryId: theirs.groceries.id })).toMatchObject({ ok: false, status: 400 });
    expect(await db.transaction.count({ where: { userId: { in: [mine.userId, theirs.userId] } } })).toBe(0);
  });
});
