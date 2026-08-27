import { z } from "zod";

// GST numbers are 15 characters: 2 state digits, 10-char PAN, entity digit,
// a literal Z, then a checksum character. Optional — not every client has one.
const GST_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export const clientSchema = z.object({
  name: z.string().min(2, "Client name must be at least 2 characters"),
  city: z.string().min(2, "City must be at least 2 characters"),
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

