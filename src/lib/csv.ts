/**
 * Turning rows into a CSV file.
 *
 * Used by: every export action (stock report, dispatch report, vendors,
 * clients). One helper so a comma or a quote mark inside a client's address can
 * never break a different export than the one it was fixed in.
 */

/**
 * A CSV, with every cell quoted.
 *
 * Quoting unconditionally is deliberate: an address containing a comma, a note
 * containing a line break and a name containing a quote mark all survive, and
 * there is no rule to remember about which cells need it.
 */
export function toCsv(headers: string[], rows: string[][]): string {
  return [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}
