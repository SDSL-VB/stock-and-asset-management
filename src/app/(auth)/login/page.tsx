import { LoginForm } from "@/components/auth/login-form";

/**
 * The sign-in page.
 *
 * `passwordChanged` arrives as a query parameter from changeOwnPasswordAction,
 * which signs people out after a successful change — without a word here, being
 * bounced to the login screen looks like the change failed.
 *
 * searchParams is a Promise in this version of Next.js, hence the await.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ passwordChanged?: string }>;
}) {
  const { passwordChanged } = await searchParams;

  return <LoginForm passwordChanged={passwordChanged === "1"} />;
}
