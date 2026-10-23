import { describe, expect, it } from "vitest";
import { looksLikeOfx, ofxDate, parseOfx } from "./ofx";

const SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261014120000.000[-5:EST]
<TRNAMT>-42.10
<FITID>A1
<NAME>LOBLAWS #123
<MEMO>Groceries &amp; more
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20261015
<TRNAMT>2500.00
<FITID>A2
<NAME>PAYROLL
</STMTTRN>
</BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

const XML = `<?xml version="1.0"?><?OFX OFXHEADER="200" VERSION="220"?>
<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260302</DTPOSTED><TRNAMT>-4.50</TRNAMT><FITID>X</FITID><NAME>Coffee</NAME></STMTTRN>
</BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`;

describe("OFX and QFX statements", () => {
  it("reads SGML (OFX 1.x) with unclosed leaf tags", () => {
    const { headers, rows } = parseOfx(SGML);
    expect(headers).toEqual(["Date", "Description", "Memo", "Amount", "Type", "Id"]);
    expect(rows).toEqual([
      { Date: "2026-10-14", Description: "LOBLAWS #123", Memo: "Groceries & more", Amount: "-42.10", Type: "DEBIT", Id: "A1" },
      { Date: "2026-10-15", Description: "PAYROLL", Memo: "", Amount: "2500.00", Type: "CREDIT", Id: "A2" },
    ]);
  });

  it("reads XML (OFX 2.x) on one line", () => {
    expect(parseOfx(XML).rows).toEqual([
      { Date: "2026-03-02", Description: "Coffee", Memo: "", Amount: "-4.50", Type: "DEBIT", Id: "X" },
    ]);
  });

  it("recognises a statement by name or content", () => {
    expect(looksLikeOfx("export.QFX", "")).toBe(true);
    expect(looksLikeOfx("statement.txt", SGML)).toBe(true);
    expect(looksLikeOfx("statement.csv", "Date,Amount\n")).toBe(false);
  });

  it("leaves a date it cannot read as written, for the import to report", () => {
    expect(ofxDate("garbage")).toBe("garbage");
  });
});
