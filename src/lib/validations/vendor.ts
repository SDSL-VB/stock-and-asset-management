import { z } from "zod";

// Same 15-character GST format as clients: 2 state digits, 10-char PAN, entity
// digit, a literal Z, then a checksum character. Optional.
const GST_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export const vendorSchema = z.object({
  name: z.string().min(2, "Vendor name must be at least 2 characters"),
  gstNumber: z
    .string()
    .trim()
    .toUpperCase()
    .regex(GST_PATTERN, "Enter a valid 15-character GST number (e.g. 29ABCDE1234F1Z5)")
    .optional()
    .or(z.literal("")),
  address: z.string().optional(),
  isActive: z.boolean().optional(),
});

