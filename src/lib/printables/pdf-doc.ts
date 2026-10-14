import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";

/**
 * A small page-layout layer over pdf-lib for the printable summary and templates.
 *
 * pdf-lib is pure JavaScript and its standard fonts ship inside the package, so a PDF is built
 * in the server process with nothing else installed: no headless browser, no system fonts, no
 * native modules. That is what keeps it working in the slim Docker image. The cost is the
 * standard fonts' character set (Windows-1252): `pdfSafe` swaps anything outside it for the
 * nearest character it has, or "?".
 *
 * Everything flows top to bottom; each block asks for the room it needs and a new page starts
 * when there is not enough.
 */

/** US Letter, in points. */
export const PAGE_WIDTH = 612;
export const PAGE_HEIGHT = 792;
const MARGIN_X = 44;
const MARGIN_TOP = 48;
/** Kept clear at the bottom for the footer line. */
const MARGIN_BOTTOM = 52;
export const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

export function hexColor(hex: string): RGB {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return rgb(0.4, 0.45, 0.55);
  return rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255);
}

/** Ink colours, chosen for paper rather than the app's dark screens. */
export const INK = {
  text: hexColor("#0f172a"),
  muted: hexColor("#64748b"),
  faint: hexColor("#94a3b8"),
  rule: hexColor("#cbd5e1"),
  hairline: hexColor("#e2e8f0"),
  fill: hexColor("#f1f5f9"),
  accent: hexColor("#0369a1"),
  positive: hexColor("#047857"),
  negative: hexColor("#b45309"),
  danger: hexColor("#b91c1c"),
  white: rgb(1, 1, 1),
} as const;

/** Characters the app's own text uses that Windows-1252 lacks, and what stands in for them. */
const SUBSTITUTES: Record<string, string> = {
  "−": "-", // minus sign
  "‐": "-",
  "‑": "-",
  " ": " ", // thin space
  " ": " ", // narrow no-break space (fr-CA currency formatting)
  "→": "->",
  "←": "<-",
  "✓": "x",
  "≤": "<=",
  "≥": ">=",
};

const charsetCache = new WeakMap<PDFFont, Set<number>>();

/** `text` with every character the font cannot draw replaced, so drawing it cannot throw. */
export function pdfSafe(font: PDFFont, text: string): string {
  let charset = charsetCache.get(font);
  if (!charset) {
    charset = new Set(font.getCharacterSet());
    charsetCache.set(font, charset);
  }
  let out = "";
  for (const ch of text.replace(/[\r\n\t]+/g, " ")) {
    const sub = SUBSTITUTES[ch];
    if (sub !== undefined) {
      out += sub;
      continue;
    }
    if (charset.has(ch.codePointAt(0)!)) {
      out += ch;
      continue;
    }
    // An accented letter outside the set still reads fine without its accent.
    const base = ch.normalize("NFKD").replace(/[̀-ͯ]/g, "");
    out += base && [...base].every((c) => charset!.has(c.codePointAt(0)!)) ? base : "?";
  }
  return out;
}

export type Align = "left" | "right" | "center";

export type Cell =
  | string
  | {
      text: string;
      color?: RGB;
      bold?: boolean;
      /** A small colour square before the text: a category's colour. */
      swatch?: string;
      /** A tick box instead of text; ticked when `checked`. */
      checkbox?: boolean;
      checked?: boolean;
    };

export type TableColumn = {
  label: string;
  /** Relative width; the columns share the content width in these proportions. */
  weight: number;
  align?: Align;
};

export type TableOptions = {
  columns: TableColumn[];
  rows: Cell[][];
  /** A bold closing row, ruled off from the rest. */
  totals?: Cell[];
  /** Taller rows leave room to write by hand. */
  rowHeight?: number;
  fontSize?: number;
  /** Draw every cell's border, as a form to fill in. */
  grid?: boolean;
  /** Shown in place of the table when there are no rows. */
  empty?: string;
};

export type BarItem = { label: string; value: number; valueText: string; color?: string; note?: string };

export type Tile = { label: string; value: string; note?: string; color?: RGB };

export class PrintDoc {
  private page!: PDFPage;
  private y = 0;
  private readonly pages: PDFPage[] = [];

  private constructor(
    private readonly pdf: PDFDocument,
    private readonly regular: PDFFont,
    private readonly bold: PDFFont,
    private readonly footer: string,
  ) {
    this.addPage();
  }

  static async create(meta: { title: string; footer: string }): Promise<PrintDoc> {
    const pdf = await PDFDocument.create();
    pdf.setTitle(meta.title);
    pdf.setCreator("Finance Tracker");
    pdf.setProducer("Finance Tracker");
    const [regular, bold] = await Promise.all([pdf.embedFont(StandardFonts.Helvetica), pdf.embedFont(StandardFonts.HelveticaBold)]);
    return new PrintDoc(pdf, regular, bold, meta.footer);
  }

  private addPage() {
    this.page = this.pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.pages.push(this.page);
    this.y = PAGE_HEIGHT - MARGIN_TOP;
  }

  /** Starts a new page unless `height` points still fit on this one. */
  ensure(height: number) {
    if (this.y - height < MARGIN_BOTTOM) this.addPage();
  }

  newPage() {
    if (this.y < PAGE_HEIGHT - MARGIN_TOP) this.addPage();
  }

  space(points: number) {
    this.y -= points;
  }

  private font(bold?: boolean) {
    return bold ? this.bold : this.regular;
  }

  textWidth(text: string, size: number, bold?: boolean): number {
    const font = this.font(bold);
    return font.widthOfTextAtSize(pdfSafe(font, text), size);
  }

  /** `text` cut down with an ellipsis until it fits `width`. */
  private fit(text: string, size: number, width: number, bold?: boolean): string {
    const font = this.font(bold);
    let safe = pdfSafe(font, text);
    if (font.widthOfTextAtSize(safe, size) <= width) return safe;
    while (safe.length > 1 && font.widthOfTextAtSize(`${safe}...`, size) > width) safe = safe.slice(0, -1);
    return `${safe.trimEnd()}...`;
  }

  private wrap(text: string, size: number, width: number, bold?: boolean): string[] {
    const font = this.font(bold);
    const words = pdfSafe(font, text).split(" ");
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width || !line) line = candidate;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  private draw(text: string, x: number, y: number, size: number, opts: { bold?: boolean; color?: RGB } = {}) {
    const font = this.font(opts.bold);
    this.page.drawText(pdfSafe(font, text), { x, y, size, font, color: opts.color ?? INK.text });
  }

  private drawAligned(text: string, x: number, width: number, y: number, size: number, align: Align, opts: { bold?: boolean; color?: RGB } = {}) {
    const fitted = this.fit(text, size, width, opts.bold);
    const w = this.font(opts.bold).widthOfTextAtSize(fitted, size);
    const left = align === "right" ? x + width - w : align === "center" ? x + (width - w) / 2 : x;
    const font = this.font(opts.bold);
    this.page.drawText(fitted, { x: left, y, size, font, color: opts.color ?? INK.text });
  }

  private rule(y: number, color: RGB = INK.rule, thickness = 0.75, x = MARGIN_X, width = CONTENT_WIDTH) {
    this.page.drawLine({ start: { x, y }, end: { x: x + width, y }, thickness, color });
  }

  /** The document's title block, at the top of the first page. */
  title(title: string, lines: string[]) {
    this.draw(title, MARGIN_X, this.y - 22, 22, { bold: true });
    this.y -= 30;
    for (const line of lines) {
      this.draw(line, MARGIN_X, this.y - 11, 10, { color: INK.muted });
      this.y -= 14;
    }
    this.y -= 4;
    this.rule(this.y, INK.accent, 1.5);
    this.y -= 14;
  }

  /** A section heading; kept on the same page as at least `keepWith` points of what follows. */
  section(title: string, note?: string, keepWith = 60) {
    const noteLines = note ? this.wrap(note, 9, CONTENT_WIDTH) : [];
    this.ensure(26 + noteLines.length * 12 + keepWith);
    this.y -= 6;
    this.draw(title, MARGIN_X, this.y - 13, 13, { bold: true, color: INK.accent });
    this.y -= 18;
    this.rule(this.y, INK.rule, 0.75);
    this.y -= 4;
    for (const line of noteLines) {
      this.draw(line, MARGIN_X, this.y - 10, 9, { color: INK.muted });
      this.y -= 12;
    }
    this.y -= 6;
  }

  paragraph(text: string, opts: { size?: number; color?: RGB; bold?: boolean; indent?: number } = {}) {
    const size = opts.size ?? 10;
    const indent = opts.indent ?? 0;
    const leading = size * 1.35;
    for (const line of this.wrap(text, size, CONTENT_WIDTH - indent, opts.bold)) {
      this.ensure(leading);
      this.draw(line, MARGIN_X + indent, this.y - size, size, { bold: opts.bold, color: opts.color });
      this.y -= leading;
    }
    this.y -= 4;
  }

  bullets(items: string[], opts: { size?: number; color?: RGB } = {}) {
    const size = opts.size ?? 10;
    const leading = size * 1.35;
    for (const item of items) {
      const lines = this.wrap(item, size, CONTENT_WIDTH - 12);
      this.ensure(leading * lines.length);
      this.draw("-", MARGIN_X + 2, this.y - size, size, { color: INK.muted });
      for (const line of lines) {
        this.draw(line, MARGIN_X + 12, this.y - size, size, { color: opts.color });
        this.y -= leading;
      }
    }
    this.y -= 4;
  }

  /** A row of figure boxes, at most four to a row. */
  tiles(items: Tile[], perRow = Math.min(4, items.length)) {
    const gap = 8;
    const height = items.some((t) => t.note) ? 52 : 42;
    const width = (CONTENT_WIDTH - gap * (perRow - 1)) / perRow;
    for (let i = 0; i < items.length; i += perRow) {
      this.ensure(height + gap);
      items.slice(i, i + perRow).forEach((tile, j) => {
        const x = MARGIN_X + j * (width + gap);
        const top = this.y;
        this.page.drawRectangle({ x, y: top - height, width, height, color: INK.fill, borderColor: INK.hairline, borderWidth: 0.75 });
        this.drawAligned(tile.label, x + 8, width - 16, top - 14, 8, "left", { color: INK.muted });
        this.drawAligned(tile.value, x + 8, width - 16, top - 31, 14, "left", { bold: true, color: tile.color });
        if (tile.note) this.drawAligned(tile.note, x + 8, width - 16, top - 44, 7.5, "left", { color: INK.muted });
      });
      this.y -= height + gap;
    }
    this.y -= 4;
  }

  table(opts: TableOptions) {
    const size = opts.fontSize ?? 9;
    const rowHeight = opts.rowHeight ?? size + 7;
    const headerHeight = size + 8;
    const totalWeight = opts.columns.reduce((s, c) => s + c.weight, 0);
    const widths = opts.columns.map((c) => (c.weight / totalWeight) * CONTENT_WIDTH);
    const xs = widths.map((_, i) => MARGIN_X + widths.slice(0, i).reduce((s, w) => s + w, 0));
    const pad = 4;

    if (opts.rows.length === 0 && opts.empty) {
      this.paragraph(opts.empty, { size: 9.5, color: INK.muted });
      return;
    }

    const header = () => {
      const top = this.y;
      this.page.drawRectangle({ x: MARGIN_X, y: top - headerHeight, width: CONTENT_WIDTH, height: headerHeight, color: INK.fill });
      opts.columns.forEach((c, i) =>
        this.drawAligned(c.label, xs[i] + pad, widths[i] - pad * 2, top - headerHeight + 5, size - 0.5, c.align ?? "left", {
          bold: true,
          color: INK.muted,
        }),
      );
      if (opts.grid) this.cellBorders(top, headerHeight, xs, widths);
      this.y -= headerHeight;
    };

    const drawRow = (cells: Cell[], bold: boolean) => {
      const top = this.y;
      const baseline = top - rowHeight + (rowHeight - size) / 2 + 1.5;
      cells.forEach((cell, i) => {
        if (i >= opts.columns.length) return;
        const c = typeof cell === "string" ? { text: cell } : cell;
        const align = opts.columns[i].align ?? "left";
        let x = xs[i] + pad;
        let width = widths[i] - pad * 2;
        if (c.checkbox) {
          const box = Math.min(10, rowHeight - 6);
          const bx = align === "center" ? xs[i] + (widths[i] - box) / 2 : x;
          const by = top - (rowHeight + box) / 2;
          this.page.drawRectangle({ x: bx, y: by, width: box, height: box, borderColor: INK.muted, borderWidth: 0.75 });
          if (c.checked) {
            this.page.drawLine({ start: { x: bx + 2, y: by + box / 2 }, end: { x: bx + box * 0.42, y: by + 2 }, thickness: 1.2, color: INK.positive });
            this.page.drawLine({ start: { x: bx + box * 0.42, y: by + 2 }, end: { x: bx + box - 1.5, y: by + box - 1.5 }, thickness: 1.2, color: INK.positive });
          }
          return;
        }
        if (c.swatch) {
          this.page.drawRectangle({ x, y: baseline - 0.5, width: 7, height: 7, color: hexColor(c.swatch) });
          x += 11;
          width -= 11;
        }
        if (c.text) this.drawAligned(c.text, x, width, baseline, size, align, { bold: bold || c.bold, color: c.color });
      });
      if (opts.grid) this.cellBorders(top, rowHeight, xs, widths);
      else this.rule(top - rowHeight, INK.hairline, 0.5);
      this.y -= rowHeight;
    };

    this.ensure(headerHeight + rowHeight * Math.min(3, opts.rows.length + 1));
    header();
    for (const row of opts.rows) {
      if (this.y - rowHeight < MARGIN_BOTTOM) {
        this.addPage();
        header();
      }
      drawRow(row, false);
    }
    if (opts.totals) {
      this.ensure(rowHeight + 2);
      this.rule(this.y, INK.muted, 1);
      drawRow(opts.totals, true);
    }
    this.y -= 10;
  }

  private cellBorders(top: number, height: number, xs: number[], widths: number[]) {
    xs.forEach((x, i) =>
      this.page.drawRectangle({ x, y: top - height, width: widths[i], height, borderColor: INK.rule, borderWidth: 0.5 }),
    );
  }

  /** Horizontal bars, one per item, scaled to the largest value. */
  bars(items: BarItem[], opts: { labelWidth?: number; valueWidth?: number } = {}) {
    const labelWidth = opts.labelWidth ?? 150;
    const valueWidth = opts.valueWidth ?? 120;
    const barWidth = CONTENT_WIDTH - labelWidth - valueWidth - 12;
    const max = Math.max(1, ...items.map((i) => Math.abs(i.value)));
    const rowHeight = 16;
    for (const item of items) {
      this.ensure(rowHeight);
      const top = this.y;
      const baseline = top - 11.5;
      this.drawAligned(item.label, MARGIN_X, labelWidth - 6, baseline, 9, "left");
      const w = Math.max(item.value > 0 ? 1.5 : 0, (Math.max(0, item.value) / max) * barWidth);
      this.page.drawRectangle({ x: MARGIN_X + labelWidth, y: top - 12.5, width: barWidth, height: 9, color: INK.fill });
      if (w > 0) this.page.drawRectangle({ x: MARGIN_X + labelWidth, y: top - 12.5, width: w, height: 9, color: hexColor(item.color ?? "#0369a1") });
      const valueText = item.note ? `${item.valueText}  ${item.note}` : item.valueText;
      this.drawAligned(valueText, MARGIN_X + labelWidth + barWidth + 12, valueWidth, baseline, 9, "right");
      this.y -= rowHeight;
    }
    this.y -= 8;
  }

  /** Paired vertical bars per column (income and spending by month, say), with a legend. */
  columnChart(columns: Array<{ label: string; values: number[] }>, series: Array<{ name: string; color: string }>, height = 120) {
    const legendHeight = 16;
    const labelHeight = 14;
    this.ensure(height + legendHeight + labelHeight + 10);
    const top = this.y;
    // Legend.
    let lx = MARGIN_X;
    for (const s of series) {
      this.page.drawRectangle({ x: lx, y: top - 9, width: 8, height: 8, color: hexColor(s.color) });
      this.draw(s.name, lx + 12, top - 8.5, 8.5, { color: INK.muted });
      lx += 24 + this.textWidth(s.name, 8.5);
    }
    const chartTop = top - legendHeight;
    const baseY = chartTop - height;
    const max = Math.max(1, ...columns.flatMap((c) => c.values.map((v) => Math.max(0, v))));
    this.rule(baseY, INK.rule, 0.75);
    const slot = CONTENT_WIDTH / Math.max(1, columns.length);
    const barGap = 1.5;
    const groupWidth = Math.min(slot * 0.7, 40);
    const barW = (groupWidth - barGap * (series.length - 1)) / series.length;
    columns.forEach((col, i) => {
      const gx = MARGIN_X + i * slot + (slot - groupWidth) / 2;
      col.values.forEach((v, j) => {
        const h = (Math.max(0, v) / max) * (height - 4);
        if (h > 0) this.page.drawRectangle({ x: gx + j * (barW + barGap), y: baseY, width: barW, height: h, color: hexColor(series[j].color) });
      });
      this.drawAligned(col.label, MARGIN_X + i * slot, slot, baseY - 10, 7.5, "center", { color: INK.muted });
    });
    this.y = baseY - labelHeight - 6;
  }

  /** Labelled write-in lines: "Label ______________". */
  writeLines(labels: string[], opts: { columns?: number } = {}) {
    const columns = opts.columns ?? 1;
    const gap = 16;
    const width = (CONTENT_WIDTH - gap * (columns - 1)) / columns;
    const rowHeight = 24;
    for (let i = 0; i < labels.length; i += columns) {
      this.ensure(rowHeight);
      labels.slice(i, i + columns).forEach((label, j) => {
        const x = MARGIN_X + j * (width + gap);
        const labelW = this.textWidth(label, 9.5) + 6;
        this.draw(label, x, this.y - 16, 9.5, { color: INK.muted });
        this.page.drawLine({ start: { x: x + labelW, y: this.y - 18 }, end: { x: x + width, y: this.y - 18 }, thickness: 0.6, color: INK.faint });
      });
      this.y -= rowHeight;
    }
    this.y -= 6;
  }

  /** Label and value pairs in two columns, for a goal's or a debt's particulars. */
  facts(pairs: Array<[string, string]>) {
    const half = CONTENT_WIDTH / 2;
    for (let i = 0; i < pairs.length; i += 2) {
      this.ensure(15);
      pairs.slice(i, i + 2).forEach(([label, value], j) => {
        const x = MARGIN_X + j * half;
        this.draw(label, x, this.y - 10, 9, { color: INK.muted });
        this.drawAligned(value, x + 110, half - 120, this.y - 10, 9.5, "left", { bold: true });
      });
      this.y -= 15;
    }
    this.y -= 6;
  }

  /**
   * A month as a calendar grid, Sunday first, with each day's entries written in its box.
   * `entries` is keyed by day of the month.
   */
  calendar(ym: string, entries: ReadonlyMap<number, string[]>, maxCellHeight = 78) {
    const [year, month] = ym.split("-").map(Number);
    const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const weeks = Math.ceil((firstDow + days) / 7);
    const colW = CONTENT_WIDTH / 7;
    const headH = 16;
    const cellH = Math.min(maxCellHeight, Math.max(Math.min(40, maxCellHeight), (this.y - MARGIN_BOTTOM - headH - 10) / weeks));
    this.ensure(headH + cellH * weeks);
    const top = this.y;
    ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach((d, i) => {
      this.page.drawRectangle({ x: MARGIN_X + i * colW, y: top - headH, width: colW, height: headH, color: INK.fill, borderColor: INK.rule, borderWidth: 0.5 });
      this.drawAligned(d, MARGIN_X + i * colW, colW, top - 11.5, 8.5, "center", { bold: true, color: INK.muted });
    });
    for (let cell = 0; cell < weeks * 7; cell++) {
      const day = cell - firstDow + 1;
      const x = MARGIN_X + (cell % 7) * colW;
      const cellTop = top - headH - Math.floor(cell / 7) * cellH;
      this.page.drawRectangle({
        x,
        y: cellTop - cellH,
        width: colW,
        height: cellH,
        borderColor: INK.rule,
        borderWidth: 0.5,
        color: day < 1 || day > days ? INK.fill : undefined,
      });
      if (day < 1 || day > days) continue;
      this.draw(String(day), x + 4, cellTop - 10, 8.5, { bold: true, color: INK.muted });
      const lines = entries.get(day) ?? [];
      const maxLines = Math.floor((cellH - 16) / 9.5);
      lines.slice(0, maxLines).forEach((line, i) => {
        const text = i === maxLines - 1 && lines.length > maxLines ? `+${lines.length - i} more` : line;
        this.drawAligned(text, x + 4, colW - 8, cellTop - 21 - i * 9.5, 7, "left");
      });
    }
    this.y = top - headH - weeks * cellH - 12;
  }

  get pageCount(): number {
    return this.pages.length;
  }

  async finish(): Promise<Uint8Array> {
    const total = this.pages.length;
    this.pages.forEach((page, i) => {
      page.drawLine({ start: { x: MARGIN_X, y: 34 }, end: { x: PAGE_WIDTH - MARGIN_X, y: 34 }, thickness: 0.5, color: INK.hairline });
      page.drawText(pdfSafe(this.regular, this.footer), { x: MARGIN_X, y: 22, size: 7.5, font: this.regular, color: INK.faint });
      const label = `Page ${i + 1} of ${total}`;
      page.drawText(label, {
        x: PAGE_WIDTH - MARGIN_X - this.regular.widthOfTextAtSize(label, 7.5),
        y: 22,
        size: 7.5,
        font: this.regular,
        color: INK.faint,
      });
    });
    return this.pdf.save();
  }
}
