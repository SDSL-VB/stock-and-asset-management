import { z } from "zod";

export const departmentSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  description: z.string().optional(),
  // The site this department sits at. Members inherit their location from it,
  // which is what scopes a central stock manager to one city.
  locationId: z.string().optional(),
  /** Marks this as the location's central stock holding */
  isCentralStock: z.boolean().optional(),
});

