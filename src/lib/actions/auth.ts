"use server";

import { signIn } from "@/auth";
import { loginSchema } from "@/lib/validations/auth";
import { AuthError } from "next-auth";

/**
 * Signing out, and the session helpers the UI calls directly.
 *
 * Called by: the topbar's sign-out control. Signing IN lives in `src/auth.ts`,
 * because NextAuth owns that half.
 */

export async function loginAction(
  _prevState: { error?: string } | undefined,
  formData: FormData
) {
  const rawData = {
    email: formData.get("email") as string,
    password: formData.get("password") as string,
  };

  const parsed = loginSchema.safeParse(rawData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: "/dashboard",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      switch (error.type) {
        case "CredentialsSignin":
          return { error: "Invalid email or password. Please try again." };
        default:
          return { error: "Something went wrong. Please try again." };
      }
    }
    throw error;
  }
}
