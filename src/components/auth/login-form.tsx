"use client";

import { useActionState } from "react";
import { loginAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, CheckCircle2, Loader2, LogIn } from "lucide-react";

export function LoginForm({ passwordChanged = false }: { passwordChanged?: boolean }) {
  const [state, formAction, isPending] = useActionState(loginAction, undefined);

  return (
    /* No Card here: the split-panel auth layout is already the container, and
       the previous <Card className="border-0 shadow-none"> was a Card with
       every Card property switched off. */
    <div className="animate-in fade-in slide-in-from-bottom-3 duration-400">
      <div className="mb-6 lg:hidden">
        <h1 className="text-h2 font-extrabold tracking-[0.04em] text-brand-navy dark:text-foreground">
          STRAIGHT DRIVE SPORTS & LEISURE PVT. LTD.
        </h1>
        <p className="text-caption font-bold tracking-[0.16em] text-brand-green uppercase">
          Stock Inventory Management (SIM)
        </p>
      </div>

      <div className="mb-6 space-y-1">
        <h2 className="text-h1">Welcome back</h2>
        <p className="text-body text-muted-foreground">
          Sign in to your account to continue
        </p>
      </div>

      <form action={formAction} className="space-y-4">
        {passwordChanged && !state?.error && (
          <div
            role="status"
            className="animate-in fade-in zoom-in-95 flex items-center gap-2 rounded-lg bg-brand-green/10 p-3 text-body text-brand-green duration-200"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>Password changed. Sign in with your new one.</span>
          </div>
        )}

        {state?.error && (
          <div
            role="alert"
            className="animate-in fade-in zoom-in-95 flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-body text-destructive duration-200"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{state.error}</span>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="email">Email address</Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="you@straightdrivesport.com"
            required
            autoComplete="email"
            autoFocus
            disabled={isPending}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            placeholder="Enter your password"
            required
            autoComplete="current-password"
            disabled={isPending}
          />
        </div>

        {/* Plain <Button>: --primary already *is* the brand green, so the
            hand-written bg-brand-green/text-brand-navy override this used to
            carry only made this button differ from every other primary CTA. */}
        <Button
          type="submit"
          size="lg"
          className="w-full font-bold transition-transform duration-200 ease-out-quart hover:-translate-y-0.5"
          disabled={isPending}
        >
          {isPending ? (
            <>
              <Loader2 className="animate-spin" />
              Signing in...
            </>
          ) : (
            <>
              <LogIn />
              Sign In
            </>
          )}
        </Button>
      </form>
    </div>
  );
}
