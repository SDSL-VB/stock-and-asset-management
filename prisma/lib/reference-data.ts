/**
 * The little reference data the app cannot start without, shared by the seed
 * (test databases) and fresh-start.ts (a real, empty one).
 */

/** Document kinds a stock entry can carry; an Invoice is required. */
export const ATTACHMENT_TYPES = [
  { name: "Invoice", isRequired: true, maxSizeBytes: 10_485_760 },
  { name: "Bill", isRequired: false, maxSizeBytes: 10_485_760 },
  { name: "Delivery Note", isRequired: false, maxSizeBytes: 5_242_880 },
];

export const DOCUMENT_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png"];
