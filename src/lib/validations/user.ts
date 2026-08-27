import { z } from "zod";

export const createUserSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[0-9]/, "Password must contain at least one number")
    .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character"),
  roleId: z.string().min(1, "Please select a role"),
  departmentId: z.string().optional(),
  phone: z.string().optional(),
});

export const updateUserSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email"),
  roleId: z.string().min(1, "Please select a role"),
  departmentId: z.string().optional(),
  phone: z.string().optional(),
  isActive: z.boolean().optional(),
});

export const changePasswordSchema = z
  .object({
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
      .regex(/[0-9]/, "Password must contain at least one number")
      .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

/**
 * Changing your OWN password. Same strength rules as an admin reset, plus the
 * current password — which is the whole difference between the two: an admin
 * resetting someone else's account does not know it, so changePasswordSchema
 * cannot ask for it.
 */
export const changeOwnPasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
      .regex(/[0-9]/, "Password must contain at least one number")
      .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })
  .refine((data) => data.password !== data.currentPassword, {
    message: "Your new password must be different from your current one",
    path: ["password"],
  });

export type CreateUserInput = z.infer<typeof createUserSchema>;
