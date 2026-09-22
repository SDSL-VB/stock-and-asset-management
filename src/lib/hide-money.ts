/**
 * Prices are a permission (stock.value.view), and hiding them on screen is not
 * enough: whatever the server returns reaches the browser, where anyone can
 * read it. So data is cleaned before it leaves the server.
 *
 * `hideMoney` walks a result and sets every money field — by name — to 0,
 * however deep it sits. Used by the stock list and entry page and by the
 * reports, for anyone without the permission.
 */
const MONEY_KEYS = new Set([
  "unitPrice",
  "totalPrice",
  "value",
  "totalValue",
  "avgUnitPrice",
  "minUnitPrice",
  "maxUnitPrice",
  "estimatedCost",
  "lineTotal",
  "cost",
]);

export function hideMoney<T>(data: T): T {
  if (Array.isArray(data)) return data.map((item) => hideMoney(item)) as T;
  if (data instanceof Date || data === null || typeof data !== "object") return data;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    out[key] = MONEY_KEYS.has(key) && typeof value === "number" ? 0 : hideMoney(value);
  }
  return out as T;
}
