import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { pdfSafe, PrintDoc } from "./pdf-doc";
import { pdfPageTexts } from "./test-pdf-text";

describe("pdfSafe", () => {
  it("keeps what Helvetica can draw and stands in for what it cannot", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    expect(pdfSafe(font, "Café – €12.50")).toBe("Café – €12.50");
    expect(pdfSafe(font, "−$5.00")).toBe("-$5.00");
    expect(pdfSafe(font, "1 234,56 $")).toBe("1 234,56 $");
    expect(pdfSafe(font, "Dāvis Lőw")).toBe("Davis Low");
    expect(pdfSafe(font, "食費")).toBe("??");
    expect(pdfSafe(font, "a\nb")).toBe("a b");
  });
});

describe("PrintDoc", () => {
  it("carries a long table onto new pages, repeating its header, and numbers every page", async () => {
    const doc = await PrintDoc.create({ title: "Test", footer: "Footer text" });
    doc.title("Big table", ["Subtitle"]);
    doc.table({
      columns: [
        { label: "Row name", weight: 3 },
        { label: "Amount", weight: 1, align: "right" },
      ],
      rows: Array.from({ length: 120 }, (_, i) => [`Row ${i + 1}`, String(i)]),
      totals: ["Total", "7140"],
    });
    const pages = await pdfPageTexts(await doc.finish());
    expect(pages.length).toBeGreaterThan(2);
    for (const [i, text] of pages.entries()) {
      expect(text).toContain("Row name");
      expect(text).toContain(`Page ${i + 1} of ${pages.length}`);
      expect(text).toContain("Footer text");
    }
    expect(pages[0]).toContain("Row 1\n");
    expect(pages.at(-1)).toContain("Row 120");
    expect(pages.at(-1)).toContain("7140");
  });

  it("cuts a cell too long for its column rather than running into the next", async () => {
    const doc = await PrintDoc.create({ title: "Test", footer: "" });
    doc.table({ columns: [{ label: "A", weight: 1 }, { label: "B", weight: 1 }], rows: [["x".repeat(400), "next"]] });
    const [text] = await pdfPageTexts(await doc.finish());
    expect(text).toMatch(/x+\.\.\./);
    expect(text).not.toContain("x".repeat(400));
  });
});
