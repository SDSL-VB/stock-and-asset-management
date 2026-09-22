/**
 * Turning rows into a CSV file.
 *
 * Used by: every export (stock report, holdings, dispatch report, vendors,
 * clients, need lists). One helper so a comma, a quote mark or a formula inside
 * something typed into the app is dealt with the same way in all of them.
 */

/**
 * A CSV, with every cell quoted.
 *
 * Quoting unconditionally is deliberate: an address containing a comma, a note
 * containing a line break and a name containing a quote mark all survive, and
 * there is no rule to remember about which cells need it.
 */
export function toCsv(headers: string[], rows: (string | number)[][]): string {
  return [headers, ...rows]
    .map((row) => row.map((cell) => `"${defuse(String(cell)).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

/**
 * A cell that starts with = + - @ (or a tab or return) is read by Excel and
 * Google Sheets as a formula, so a vendor named "=HYPERLINK(…)" typed into the
 * app could run when a buyer opens the export. Such cells get a leading
 * apostrophe, which spreadsheets treat as "this is text". A plain number such
 * as -5 is left alone.
 */
function defuse(cell: string): string {
  if (/^[=+\-@\t\r]/.test(cell) && !/^-?\d+(\.\d+)?$/.test(cell)) return `'${cell}`;
  return cell;
}
