/**
 * Where on the shelves a stock entry sits: `rack.row`, e.g. "10.3" is rack 10,
 * row 3. One place for the format so the entry form, a delivery's lines, the
 * "change rack" box and the Find stock page all accept and print it alike.
 *
 * A rack may be numbered or lettered (10, A, B2); the row is a number. Stored
 * upper-cased, so "b2.1" and "B2.1" are the same spot.
 */
export const RACK_PATTERN = /^[A-Z0-9]{1,6}\.[0-9]{1,3}$/;

export const RACK_HINT = "Rack and row, like 10.3 (rack 10, row 3)";

/** "b2.1 " → "B2.1"; "" or null → null. Does not validate — see RACK_PATTERN. */
export function normalizeRack(value: string | null | undefined): string | null {
  const v = value?.trim().toUpperCase();
  return v ? v : null;
}

/** "10.3" → "Rack 10, row 3" */
export function rackLabel(rack: string): string {
  const [shelf, row] = rack.split(".");
  return `Rack ${shelf}, row ${row}`;
}
