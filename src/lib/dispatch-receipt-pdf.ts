import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/**
 * A consignment as a one-page receipt — what goes with the goods, or to the
 * client who is being invoiced for them.
 *
 * Called by: exportDispatchReceipt() in src/lib/actions/dispatch.ts, which has
 * already checked the person may see the consignment and whether they may see
 * what it is worth. This file only lays the page out: hand it no prices and it
 * prints no money columns, so the permission is enforced in one place rather
 * than being re-decided here.
 *
 * Built the same way as the need-list document (src/lib/need-list-pdf.ts):
 * pdf-lib's standard Helvetica, nothing embedded, every string passed through
 * `printable()` so one character outside the Western European set cannot fail
 * the whole download.
 */

export type DispatchReceiptDocument = {
  dispatchNumber: string;
  status: string;
  raisedOn: Date;
  raisedBy: string;
  from: string;
  /** The receiving site, or the client's name */
  to: string;
  toKind: "Site" | "Client";
  clientCity: string | null;
  clientGst: string | null;
  clientAddress: string | null;
  receivedOn: Date | null;
  receivedBy: string | null;
  notes: string | null;
  lines: {
    entryNumber: string;
    itemCode: string | null;
    itemName: string;
    batchNumber: string | null;
    quantity: number;
    isAsset: boolean;
    /** Null when the reader may not see value — the money columns vanish */
    unitPrice: number | null;
    value: number | null;
  }[];
  totalValue: number | null;
};

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 40;
const INK = rgb(0.09, 0.14, 0.17);
const MUTED = rgb(0.42, 0.47, 0.5);
const RULE = rgb(0.84, 0.86, 0.82);

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

/** "1,234.00" — the rupee sign is not in the standard font, so the column says INR. */
function money(n: number): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function renderDispatchReceiptPdf(doc: DispatchReceiptDocument): Promise<Uint8Array> {
  const withMoney = doc.totalValue !== null;

  // Columns, left to right. Widths are in points and sum to the usable width.
  const columns = withMoney
    ? [
        { key: "index", label: "#", width: 20 },
        { key: "code", label: "Code", width: 95 },
        { key: "item", label: "Item", width: 150 },
        { key: "batch", label: "Batch", width: 70 },
        { key: "quantity", label: "Qty", width: 40, align: "right" as const },
        { key: "unitPrice", label: "Unit (INR)", width: 60, align: "right" as const },
        { key: "value", label: "Value (INR)", width: 80, align: "right" as const },
      ]
    : [
        { key: "index", label: "#", width: 24 },
        { key: "code", label: "Code", width: 120 },
        { key: "item", label: "Item", width: 200 },
        { key: "batch", label: "Batch", width: 91 },
        { key: "quantity", label: "Qty", width: 80, align: "right" as const },
      ];

  const pdf = await PDFDocument.create();
  pdf.setTitle(`Dispatch ${doc.dispatchNumber}`);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = pdf.addPage([A4.width, A4.height]);
  let y = A4.height - MARGIN;

  const text = (value: string, x: number, size: number, font = regular, color = INK) => {
    page.drawText(printable(font, value), { x, y, size, font, color });
  };

  // ---- heading --------------------------------------------------------------
  text(`Dispatch receipt ${doc.dispatchNumber}`, MARGIN, 18, bold);
  y -= 22;
  text(`${doc.from}  ->  ${doc.to}${doc.clientCity ? ` (${doc.clientCity})` : ""}`, MARGIN, 11);
  y -= 16;
  text(
    [
      doc.status,
      `Raised by ${doc.raisedBy} on ${doc.raisedOn.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`,
      `${doc.lines.length} line${doc.lines.length === 1 ? "" : "s"}`,
    ].join("   ·   "),
    MARGIN,
    9,
    regular,
    MUTED
  );
  y -= 16;

  // A client consignment carries the details an invoice needs
  for (const line of [doc.clientGst ? `GST: ${doc.clientGst}` : null, doc.clientAddress].filter(Boolean)) {
    text(fit(regular, line as string, 9, A4.width - MARGIN * 2), MARGIN, 9, regular, MUTED);
    y -= 12;
  }
  if (doc.receivedOn) {
    text(
      `Received${doc.receivedBy ? ` by ${doc.receivedBy}` : ""} on ${doc.receivedOn.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`,
      MARGIN,
      9,
      regular,
      MUTED
    );
    y -= 12;
  }
  y -= 10;

  // ---- table ----------------------------------------------------------------
  const drawHeader = () => {
    let x = MARGIN;
    for (const col of columns) {
      const lx = col.align === "right" ? x + col.width - bold.widthOfTextAtSize(col.label, 8) - 4 : x;
      page.drawText(col.label, { x: lx, y, size: 8, font: bold, color: MUTED });
      x += col.width;
    }
    y -= 6;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: A4.width - MARGIN, y }, thickness: 0.75, color: RULE });
    y -= 14;
  };
  drawHeader();

  doc.lines.forEach((line, i) => {
    if (y - 16 < MARGIN + 40) {
      page = pdf.addPage([A4.width, A4.height]);
      y = A4.height - MARGIN;
      drawHeader();
    }

    const cells: Record<string, string> = {
      index: String(i + 1),
      code: line.itemCode ?? line.entryNumber,
      item: line.itemName + (line.isAsset ? " (asset)" : ""),
      batch: line.batchNumber ?? "-",
      quantity: line.quantity.toLocaleString("en-IN"),
      unitPrice: line.unitPrice === null ? "" : money(line.unitPrice),
      value: line.value === null ? "" : money(line.value),
    };

    let x = MARGIN;
    for (const col of columns) {
      const font = col.key === "item" ? bold : regular;
      const value = fit(font, printable(font, cells[col.key]), 9, col.width - 6);
      const cx = col.align === "right" ? x + col.width - font.widthOfTextAtSize(value, 9) - 4 : x;
      page.drawText(value, { x: cx, y, size: 9, font, color: INK });
      x += col.width;
    }

    y -= 16;
    page.drawLine({ start: { x: MARGIN, y: y + 8 }, end: { x: A4.width - MARGIN, y: y + 8 }, thickness: 0.4, color: RULE });
  });

  // ---- total, then what was said about it ------------------------------------
  if (doc.totalValue !== null) {
    y -= 6;
    const label = "Consignment total (INR)";
    const amount = money(doc.totalValue);
    page.drawText(label, {
      x: A4.width - MARGIN - bold.widthOfTextAtSize(amount, 11) - 12 - bold.widthOfTextAtSize(label, 10),
      y,
      size: 10,
      font: bold,
      color: MUTED,
    });
    page.drawText(amount, {
      x: A4.width - MARGIN - bold.widthOfTextAtSize(amount, 11),
      y,
      size: 11,
      font: bold,
      color: INK,
    });
    y -= 20;
  }

  if (doc.notes) {
    y -= 6;
    text("Notes", MARGIN, 9, bold, MUTED);
    y -= 12;
    text(fit(regular, doc.notes, 9, A4.width - MARGIN * 2), MARGIN, 9);
    y -= 14;
  }

  // Somewhere to sign: a receipt that nobody acknowledges is only a packing list
  y -= 24;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + 180, y }, thickness: 0.6, color: RULE });
  page.drawLine({ start: { x: A4.width - MARGIN - 180, y }, end: { x: A4.width - MARGIN, y }, thickness: 0.6, color: RULE });
  y -= 12;
  text("Dispatched by", MARGIN, 8, regular, MUTED);
  page.drawText("Received by", {
    x: A4.width - MARGIN - 180,
    y,
    size: 8,
    font: regular,
    color: MUTED,
  });

  // ---- footer on every page ---------------------------------------------------
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawText(`${doc.dispatchNumber}  ·  page ${i + 1} of ${pages.length}`, {
      x: MARGIN,
      y: MARGIN - 18,
      size: 8,
      font: regular,
      color: MUTED,
    });
  });

  return pdf.save();
}
