import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/**
 * A need request as a one-document PDF — what a buyer downloads and sends on.
 *
 * Called by: exportNeedListPdf() in src/lib/actions/needs.ts, which has already
 * checked the person may download it. This file only lays the page out.
 *
 * Built with pdf-lib's standard Helvetica, so nothing is embedded and the file
 * stays a few kilobytes. The catch with standard fonts is that they only carry
 * the Western European character set: a character outside it (a ₹, an emoji, a
 * name in another script) would make pdf-lib throw and the download fail. So
 * every string goes through `printable()` first, which swaps anything the font
 * cannot draw for a "?" rather than losing the whole document over one glyph.
 */

export type NeedListDocument = {
  listNumber: string;
  reason: string;
  site: string | null;
  raisedBy: string;
  raisedOn: Date;
  lines: {
    needNumber: string;
    code: string;
    name: string;
    description: string | null;
    quantity: number;
    unit: string;
    vendor: string | null;
    status: string;
  }[];
};

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 40;
const INK = rgb(0.09, 0.14, 0.17);
const MUTED = rgb(0.42, 0.47, 0.5);
const RULE = rgb(0.84, 0.86, 0.82);

/** Columns, left to right. Widths are in points and sum to the usable width. */
const COLUMNS = [
  { key: "index", label: "#", width: 22 },
  { key: "code", label: "Code", width: 110 },
  { key: "item", label: "Item", width: 175 },
  { key: "quantity", label: "Qty", width: 60, align: "right" as const },
  { key: "vendor", label: "Vendor", width: 78 },
  // Wide enough for the longest status word, "Ready to order"
  { key: "status", label: "Status", width: 70 },
];

/** Anything the standard font cannot draw becomes "?" instead of an exception. */
function printable(font: PDFFont, text: string): string {
  let out = "";
  for (const ch of text) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += "?";
    }
  }
  return out;
}

/** Shortens text to fit a width, marking the cut with an ellipsis. */
function fit(font: PDFFont, text: string, size: number, width: number): string {
  if (font.widthOfTextAtSize(text, size) <= width) return text;
  let cut = text;
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut}...`, size) > width) cut = cut.slice(0, -1);
  return `${cut}...`;
}

export async function renderNeedListPdf(doc: NeedListDocument): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Need list ${doc.listNumber}`);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = pdf.addPage([A4.width, A4.height]);
  let y = A4.height - MARGIN;

  const text = (value: string, x: number, size: number, font = regular, color = INK) => {
    page.drawText(printable(font, value), { x, y, size, font, color });
  };

  // ---- heading --------------------------------------------------------------
  text(`Need list ${doc.listNumber}`, MARGIN, 18, bold);
  y -= 22;
  text(doc.reason, MARGIN, 11);
  y -= 16;
  const meta = [
    doc.site ? `Site: ${doc.site}` : null,
    `Raised by ${doc.raisedBy} on ${doc.raisedOn.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`,
    `${doc.lines.length} item${doc.lines.length === 1 ? "" : "s"}`,
  ].filter(Boolean).join("   ·   ");
  text(meta, MARGIN, 9, regular, MUTED);
  y -= 24;

  // ---- table ----------------------------------------------------------------
  const drawHeader = () => {
    let x = MARGIN;
    for (const col of COLUMNS) {
      const label = col.label;
      const lx = col.align === "right" ? x + col.width - bold.widthOfTextAtSize(label, 8) - 4 : x;
      page.drawText(label, { x: lx, y, size: 8, font: bold, color: MUTED });
      x += col.width;
    }
    y -= 6;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: A4.width - MARGIN, y }, thickness: 0.75, color: RULE });
    y -= 14;
  };
  drawHeader();

  doc.lines.forEach((line, i) => {
    // Two text rows per line when there is a description, one otherwise
    const rowHeight = line.description ? 26 : 16;
    if (y - rowHeight < MARGIN + 20) {
      page = pdf.addPage([A4.width, A4.height]);
      y = A4.height - MARGIN;
      drawHeader();
    }

    const cells: Record<string, string> = {
      index: String(i + 1),
      code: line.code,
      item: line.name,
      quantity: `${line.quantity.toLocaleString("en-IN", { maximumFractionDigits: 4 })} ${line.unit}`,
      vendor: line.vendor ?? "-",
      status: line.status,
    };

    let x = MARGIN;
    for (const col of COLUMNS) {
      const font = col.key === "item" ? bold : regular;
      const value = fit(font, printable(font, cells[col.key]), 9, col.width - 6);
      const cx = col.align === "right" ? x + col.width - font.widthOfTextAtSize(value, 9) - 4 : x;
      page.drawText(value, { x: cx, y, size: 9, font, color: INK });
      x += col.width;
    }
    if (line.description) {
      const itemX = MARGIN + COLUMNS[0].width + COLUMNS[1].width;
      const desc = fit(regular, printable(regular, line.description), 8, COLUMNS[2].width - 6);
      page.drawText(desc, { x: itemX, y: y - 11, size: 8, font: regular, color: MUTED });
    }

    y -= rowHeight;
    page.drawLine({ start: { x: MARGIN, y: y + 8 }, end: { x: A4.width - MARGIN, y: y + 8 }, thickness: 0.4, color: RULE });
  });

  // ---- footer on every page ---------------------------------------------------
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawText(`${doc.listNumber}  ·  page ${i + 1} of ${pages.length}`, {
      x: MARGIN,
      y: MARGIN - 18,
      size: 8,
      font: regular,
      color: MUTED,
    });
  });

  return pdf.save();
}
