import { describe, expect, it } from "vitest";
import { escapeCsvCell, parseCsvLine, parseCsvRecords, parseCsvText, toCsv, toCsvRow } from "./csv";

describe("parseCsvText", () => {
  it("maps header cells onto each row and trims cells", () => {
    const { headers, rows } = parseCsvText("Date, Amount ,Memo\n2026-01-02, -12.50 ,Coffee\n");
    expect(headers).toEqual(["Date", "Amount", "Memo"]);
    expect(rows).toEqual([{ Date: "2026-01-02", Amount: "-12.50", Memo: "Coffee" }]);
  });

  it("keeps a newline inside a quoted cell in the same row", () => {
    const text = 'Date,Amount,Memo\n2026-01-02,-12.50,"Coffee\nwith a friend"\n2026-01-03,-3.00,Tea';
    const { rows } = parseCsvText(text);
    expect(rows).toHaveLength(2);
    expect(rows[0].Memo).toBe("Coffee\nwith a friend");
    expect(rows[1]).toEqual({ Date: "2026-01-03", Amount: "-3.00", Memo: "Tea" });
  });

  it("handles quoted commas, escaped quotes and CRLF line endings", () => {
    const text = 'Date,Amount,Memo\r\n2026-01-02,"1,234.56","He said ""hi"""\r\n';
    const { rows } = parseCsvText(text);
    expect(rows).toEqual([{ Date: "2026-01-02", Amount: "1,234.56", Memo: 'He said "hi"' }]);
  });

  it("drops blank lines and fills missing trailing cells with empty strings", () => {
    const { rows } = parseCsvText("A,B,C\n\n1,2\n   \n3,4,5\n");
    expect(rows).toEqual([
      { A: "1", B: "2", C: "" },
      { A: "3", B: "4", C: "5" },
    ]);
  });

  it("returns nothing for a header-only file", () => {
    expect(parseCsvText("A,B\n")).toEqual({ headers: [], rows: [] });
    expect(parseCsvText("")).toEqual({ headers: [], rows: [] });
  });
});

describe("parseCsvRecords / parseCsvLine", () => {
  it("treats a lone CR as a record separator", () => {
    expect(parseCsvRecords("a,b\rc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("parses a single line", () => {
    expect(parseCsvLine('x,"y,z",w')).toEqual(["x", "y,z", "w"]);
    expect(parseCsvLine("")).toEqual([""]);
  });
});

describe("escapeCsvCell", () => {
  it("passes ordinary values through untouched", () => {
    expect(escapeCsvCell("user@example.com")).toBe("user@example.com");
    expect(escapeCsvCell(42)).toBe("42");
  });

  it("renders null and undefined as an empty field", () => {
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(undefined)).toBe("");
  });

  it("quotes and doubles embedded quotes", () => {
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it("quotes values containing a comma or a newline", () => {
    expect(escapeCsvCell("a,b")).toBe('"a,b"');
    expect(escapeCsvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it.each(["=", "+", "-", "@", "\t", "\r"])("defuses a cell starting with %j", (prefix) => {
    expect(escapeCsvCell(`${prefix}cmd`).includes("'")).toBe(true);
  });

  it("defuses a formula and still quotes it when it contains a comma", () => {
    // Both rules apply: the apostrophe stops execution, the quoting keeps the row intact.
    expect(escapeCsvCell('=HYPERLINK("http://evil","click")')).toBe(
      `"'=HYPERLINK(""http://evil"",""click"")"`,
    );
  });

  it("does not defuse a value that merely contains an equals sign", () => {
    expect(escapeCsvCell("a=b")).toBe("a=b");
  });
});

describe("toCsvRow / toCsv", () => {
  it("joins cells with commas", () => {
    expect(toCsvRow(["a", "b", null])).toBe("a,b,");
  });

  it("emits a header then rows, separated by CRLF", () => {
    expect(toCsv(["one", "two"], [["a", "b"], ["c", "d"]])).toBe("one,two\r\na,b\r\nc,d");
  });

  it("emits just the header for an empty result", () => {
    expect(toCsv(["one"], [])).toBe("one");
  });
});

describe("round trip", () => {
  it("parses back what it writes, formula prefix aside", () => {
    const csv = toCsv(["a", "b"], [["plain, with comma", 'quote " inside']]);
    expect(parseCsvText(csv).rows[0]).toEqual({ a: "plain, with comma", b: 'quote " inside' });
  });
});
