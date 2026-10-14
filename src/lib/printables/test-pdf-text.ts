import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream, type PDFPage } from "pdf-lib";

/**
 * The text drawn on each page of a PDF this app made, one string per page with each drawn run
 * on its own line. For tests: it proves a figure is really on the page, not just in the data.
 * pdf-lib writes every run as a hex string shown with `Tj`, in WinAnsi, so that is all this reads.
 */
export async function pdfPageTexts(bytes: Uint8Array): Promise<string[]> {
  const pdf = await PDFDocument.load(bytes);
  return pdf.getPages().map((page) => pageText(pdf, page));
}

function pageText(pdf: PDFDocument, page: PDFPage): string {
  const contents = page.node.Contents();
  const refs = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
  const runs: string[] = [];
  for (const ref of refs) {
    const stream = pdf.context.lookup(ref);
    if (!(stream instanceof PDFRawStream)) continue;
    const ops = Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
    for (const m of ops.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)) {
      runs.push(Buffer.from(m[1], "hex").toString("latin1"));
    }
  }
  return runs.join("\n");
}
