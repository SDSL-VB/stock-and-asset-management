"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { grantPermission, revokePermission } from "@/lib/actions/user-permissions";
import {
  LinkedPermissionsDialog,
  type LinkedPrompt,
} from "@/components/shared/linked-permissions-dialog";
import { toast } from "sonner";
import { Plus, X, KeyRound, CalendarClock, Search, Check } from "lucide-react";

type Grant = {
  id: string;
  key: string;
  name: string;
  module: string;
  description: string | null;
  reason: string;
  expiresAt: Date | null;
  expired: boolean;
  grantedByName: string;
  createdAt: Date;
};

type Grantable = {
  key: string;
  name: string;
  module: string;
  description: string | null;
};

interface Props {
  userId: string;
  userName: string;
  roleName: string;
  rolePermissionCount: number;
  grants: Grant[];
  grantable: Grantable[];
}

/**
 * Permissions this person holds on top of their role.
 *
 * Grants only — nothing here can take a capability away, so "why can't she do
 * this?" is always answered by looking at her role. Every grant carries the
 * reason it was given and who gave it, because a grant nobody can explain is
 * one nobody will ever dare remove.
 *
 * This card is rendered only for holders of users.permissions.grant, and never
 * on your own profile.
 */
export function ExtraPermissionsCard({
  userId,
  userName,
  roleName,
  rolePermissionCount,
  grants,
  grantable,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [permissionKey, setPermissionKey] = useState("");
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [query, setQuery] = useState("");
  const [linkPrompt, setLinkPrompt] = useState<LinkedPrompt | null>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return grantable;
    return grantable.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.key.toLowerCase().includes(q) ||
        (p.description?.toLowerCase().includes(q) ?? false)
    );
  }, [grantable, query]);

  // Tomorrow, so "expires today" can never be chosen by accident
  const earliest = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }, []);

  function reset() {
    setAdding(false);
    setPermissionKey("");
    setReason("");
    setExpiresAt("");
    setQuery("");
  }

  function grant(alsoGrant = false) {
    startTransition(async () => {
      const res = await grantPermission(userId, {
        permissionKey,
        reason,
        expiresAt,
        alsoGrant,
      });
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      // The permission cannot work on its own — say so before saving it
      if ("needsLinked" in res && res.needsLinked) {
        setLinkPrompt({
          key: permissionKey,
          name: res.permissionName ?? permissionKey,
          reason: res.reason ?? "It depends on another permission.",
          missing: res.missing ?? [],
        });
        return;
      }
      toast.success(`${userName} now holds that permission`);
      reset();
      router.refresh();
    });
  }

  function revoke(id: string, name: string) {
    startTransition(async () => {
      const res = await revokePermission(id);
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      toast.success(`Removed "${name}"`);
      router.refresh();
    });
  }

  return (
    <>
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            Extra permissions
          </CardTitle>
          <p className="mt-1 text-caption text-muted-foreground">
            On top of the {rolePermissionCount} that {roleName} already carries. These can only
            add — never take away.
          </p>
        </div>
        {!adding && grantable.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Grant one
          </Button>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {adding && (
          <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
            {/*
              A list of 80-odd permissions is unusable as a plain dropdown, and
              the key alone rarely says what a permission does — so the search
              matches the name, the key *and* the description.
            */}
            <div className="space-y-1.5">
              <Label htmlFor="permission-search">Permission</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="permission-search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by name, key or what it does"
                  className="pl-9"
                  autoComplete="off"
                />
              </div>

              <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border p-1">
                {matches.length === 0 ? (
                  <p className="px-2 py-6 text-center text-caption text-muted-foreground">
                    {grantable.length === 0
                      ? `${roleName} already carries everything you could grant.`
                      : "Nothing matches that search."}
                  </p>
                ) : (
                  matches.map((p) => {
                    const isPicked = p.key === permissionKey;
                    return (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => setPermissionKey(isPicked ? "" : p.key)}
                        className={cn(
                          "flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors",
                          isPicked ? "bg-primary/10" : "hover:bg-muted/60"
                        )}
                      >
                        <span
                          className={cn(
                            "mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                            isPicked ? "border-primary bg-primary text-primary-foreground" : "border-input"
                          )}
                        >
                          {isPicked && <Check className="h-3 w-3" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-baseline gap-x-2">
                            <span className="text-sm font-medium">{p.name}</span>
                            <code className="rounded bg-muted px-1 py-0.5 font-mono text-micro text-muted-foreground">
                              {p.key}
                            </code>
                          </span>
                          {p.description && (
                            <span className="mt-0.5 block text-caption text-muted-foreground">
                              {p.description}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
              <p className="text-micro text-muted-foreground">
                Showing {matches.length} of {grantable.length}. Only permissions you hold
                yourself are offered.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="grant-reason">Why does {userName} need it?</Label>
              <Input
                id="grant-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Covering the dispatch desk while Meera is away"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="grant-expiry">Ends on (optional)</Label>
              <Input
                id="grant-expiry"
                type="date"
                min={earliest}
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="w-[200px]"
              />
              <p className="text-micro text-muted-foreground">
                Leave it empty and the permission stays until someone removes it.
              </p>
            </div>

            <div className="flex gap-2">
              <Button size="sm" onClick={() => grant(false)} disabled={pending || !permissionKey || !reason.trim()}>
                Grant
              </Button>
              <Button size="sm" variant="ghost" onClick={reset} disabled={pending}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {grants.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            {userName} holds exactly what {roleName} carries, and nothing more.
          </p>
        ) : (
          <div className="space-y-2">
            {grants.map((g) => (
              <div
                key={g.id}
                className="flex items-start gap-3 rounded-lg border px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{g.name}</span>
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-micro text-muted-foreground">
                      {g.key}
                    </code>
                    {g.expired ? (
                      <Badge
                        variant="outline"
                        className="border-slate-200 bg-slate-50 text-micro text-slate-600"
                      >
                        expired
                      </Badge>
                    ) : (
                      g.expiresAt && (
                        <Badge
                          variant="outline"
                          className="border-amber-200 bg-amber-50 text-micro text-amber-900"
                        >
                          <CalendarClock className="mr-1 h-3 w-3" />
                          until{" "}
                          {new Date(g.expiresAt).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                        </Badge>
                      )
                    )}
                  </div>
                  <p className="mt-0.5 text-caption text-muted-foreground">
                    {g.reason} · granted by {g.grantedByName}
                  </p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => revoke(g.id, g.name)}
                  disabled={pending}
                  aria-label={`Remove ${g.name}`}
                >
                  <X className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>

    <LinkedPermissionsDialog
      prompt={linkPrompt}
      onGrantAll={() => {
        setLinkPrompt(null);
        grant(true);
      }}
      onGrantAnyway={() => {
        setLinkPrompt(null);
        toast.info("Not granted — it would not work without what it depends on.");
      }}
      onCancel={() => setLinkPrompt(null)}
    />
    </>
  );
}
