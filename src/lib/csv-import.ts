/**
 * Reading a spreadsheet somebody filled in.
 *
 * Used by: the bulk product upload (src/lib/actions/product-import.ts) and the
 * delivery form's "fill from a file". Both hand this the text of a CSV — which
 * is what Excel writes with File → Save As → CSV — and get back one object per
 * row, keyed by the column headings.
 *
 * Why CSV and not .xlsx: an .xlsx file is a zip of XML and needs a library to
 * open. CSV needs nothing, so nothing new can go wrong with it and there is no
 * third-party code in the path of a file somebody uploads. Every spreadsheet
 * program writes it.
 *
 * The parser is deliberately complete rather than a `split(",")`: a description
 * with a comma in it, a quoted field containing quotes, Windows line endings
 * and Excel's byte-order mark are all ordinary things in a file a person made,
 * and each of them would otherwise shift every column after it.
 *
 * Headings are matched loosely — case, spaces and underscores are ignored — so
 * "Unit Price", "unit price" and "unit_price" are the same column. That keeps a
 * template usable after somebody has tidied it up.
 *
 * Callers can also name ALIASES for a column, which is what lets a file this
 * app exported be fed back to it: the holdings report calls the column "Item
 * Code" and the delivery template calls it "Product Code", and somebody who
 * downloaded one and uploaded it should not be told to start again over a
 * word. And when a file really is the wrong shape, the refusal lists the
 * headings it actually found, so the answer is on screen rather than guessed.
 */

/** One row of the file, keyed by heading. Values are trimmed, never null. */
export type CsvRow = Record<string, string>;

export type CsvTable = {
  /** The headings as written in the file, in order */
  headings: string[];
  rows: CsvRow[];
};

/** Split CSV text into cells, honouring quotes, escaped quotes and CRLF. */
/**
 * Is this actually an Excel workbook? A .xlsx is a zip, and every zip starts
 * "PK". Reading one as text produces gibberish and then a baffling complaint
 * about missing columns, so it is worth recognising and saying.
 */
export function looksLikeExcel(text: string): boolean {
  return text.startsWith("PK\x03\x04") || text.startsWith("PK");
}

export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];

    if (quoted) {
      if (ch === '"') {
        // "" inside a quoted field is one literal quote
        if (clean[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  // Whatever the file ended on, if it was not an empty trailing line
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  // A row of nothing but commas is the blank line at the end of a spreadsheet
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** "Unit Price" and "unit_price" are the same column. */
function normalise(heading: string): string {
  return heading.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

/**
 * The file as rows keyed by heading, or what is wrong with it.
 *
 * `required` names the headings that must be present; naming them here means a
 * file with a column missing is refused once, up front, rather than producing
 * fifty rows that each complain about the same thing.
 */
export function readCsvTable(
  text: string,
  required: string[] = [],
  /** Other headings that mean the same column — { "Product Code": ["Item Code"] } */
  aliases: Record<string, string[]> = {},
  /**
   * The other uploads this app has, so a file given to the wrong one is told
   * where it belongs rather than being told a column is missing. Each is a
   * heading only that upload has, and what to say when it is found.
   */
  elsewhere: { heading: string; belongsTo: string }[] = []
): { table: CsvTable } | { error: string } {
  if (looksLikeExcel(text)) {
    return {
      error:
        "That is an Excel workbook (.xlsx), which this cannot read. Open it in Excel and choose File → Save As → CSV, then upload that.",
    };
  }

  const cells = parseCsv(text);
  if (cells.length === 0) return { error: "That file is empty" };

  const headings = cells[0].map((h) => h.trim());
  const keys = headings.map(normalise);

  // A column found under one of its other names is read as the real one
  for (const [canonical, others] of Object.entries(aliases)) {
    const want = normalise(canonical);
    if (keys.includes(want)) continue;
    const found = keys.findIndex((k) => others.some((other) => normalise(other) === k));
    if (found >= 0) keys[found] = want;
  }

  const missing = required.filter((want) => !keys.includes(normalise(want)));
  if (missing.length > 0) {
    const other = elsewhere.find((e) => keys.includes(normalise(e.heading)));
    if (other) {
      return { error: `That file is a ${other.belongsTo} list — upload it there instead.` };
    }
    return {
      error:
        `That file does not have ${missing.length === 1 ? "a column called" : "columns called"} ${missing.join(" or ")}. ` +
        `It has: ${headings.join(", ") || "no headings at all"}. ` +
        `Download the template — it is the format this reads.`,
    };
  }

  const rows = cells.slice(1).map((line) => {
    const row: CsvRow = {};
    keys.forEach((key, i) => {
      row[key] = (line[i] ?? "").trim();
    });
    return row;
  });

  if (rows.length === 0) return { error: "That file has headings but no rows" };
  return { table: { headings, rows } };
}

/** Read one column out of a row, by any spelling of its heading. */
export function cell(row: CsvRow, heading: string): string {
  return row[normalise(heading)] ?? "";
}

/**
 * A template file: the headings, and one example row to show what is expected.
 * Quoted the same way `toCsv` quotes, so the two cannot disagree about escaping.
 */
export function templateCsv(headings: string[], example: string[]): string {
  const quote = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [headings.map(quote).join(","), example.map(quote).join(",")].join("\n");
}
