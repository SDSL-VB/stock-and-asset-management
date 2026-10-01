"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { setApprovalSwitch, getApprovalFlows } from "@/lib/actions/approval-settings";
import type { ApprovalSwitch } from "@/lib/approval-catalog";

/**
 * One card per approval: its steps, the permission deciding each, and the
 * roles holding it. Bill-of-materials review and verifying needs carry a
 * switch; with it off, whatever is raised goes straight through.
 */

type Data = Awaited<ReturnType<typeof getApprovalFlows>>;

const SWITCH_OFF_MEANS: Record<ApprovalSwitch, string> = {
  bom: "Off: anyone who can write a bill of materials publishes it straight away",
  needs: "Off: a need can be ordered as soon as it is raised",
};

export function ApprovalFlowList({ flows, switches }: Data) {
  const router = useRouter();
  const [saving, setSaving] = useState<ApprovalSwitch | null>(null);

  const flip = async (which: ApprovalSwitch, on: boolean) => {
    setSaving(which);
    try {
      const result = await setApprovalSwitch({ which, on });
      if (result.error) toast.error(result.error);
      else {
        toast.success(on ? "Approval switched on" : "Approval switched off");
        router.refresh();
      }
    } catch {
      toast.error("Something went wrong");
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {flows.map((flow) => (
        <Card key={flow.id}>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="text-base">{flow.title}</CardTitle>
                <CardDescription>Decided on the {flow.where} page</CardDescription>
              </div>
              {flow.toggle && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{switches[flow.toggle] ? "Required" : "Off"}</span>
                  <Switch
                    checked={switches[flow.toggle]}
                    disabled={saving === flow.toggle}
                    onCheckedChange={(on) => flip(flow.toggle!, on)}
                  />
                </div>
              )}
            </div>
            {flow.toggle && !switches[flow.toggle] && (
              <p className="text-xs text-amber-600">{SWITCH_OFF_MEANS[flow.toggle]}</p>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {flow.steps.map((step) => (
              <div key={step.label} className="rounded-md border p-3 space-y-2">
                <p className="text-sm font-medium">{step.label}</p>
                <p className="text-xs text-muted-foreground">Sees: {step.reach}</p>
                {step.deciders.map((d) => (
                  <div key={d.key} className="text-xs space-y-1">
                    <p>
                      Decided by holders of <span className="font-semibold">{d.name}</span>{" "}
                      <span className="font-mono text-muted-foreground">({d.key})</span>
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {d.roles.length > 0 ? (
                        d.roles.map((r) => (
                          <Badge key={r} variant="secondary">
                            {r}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-amber-600">No role holds this — nobody can decide it</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
      <p className="text-xs text-muted-foreground lg:col-span-2">
        Anyone who could approve something has it approved when they raise it — except a dispatch, which the
        receiving site always accepts. Individual grants on a person&apos;s profile also count. Change who decides on
        the <Link href="/roles" className="underline">Roles</Link> page.
      </p>
    </div>
  );
}
