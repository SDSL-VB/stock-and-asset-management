"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { saveBomFlow } from "@/lib/actions/bom-flow";
import { toast } from "sonner";

interface Props {
  requiresApproval: boolean;
  approverRoleId: string | null;
  roles: { id: string; name: string }[];
}

/**
 * One rule for the whole company. A bill of materials describes a product, and
 * a product does not belong to a department — which is exactly why the stock
 * entry flow is per-department and this one is not.
 */
export function BomFlowCard({ requiresApproval, approverRoleId, roles }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [required, setRequired] = useState(requiresApproval);
  const [roleId, setRoleId] = useState(approverRoleId ?? "");

  const dirty = required !== requiresApproval || roleId !== (approverRoleId ?? "");

  const items = [
    { value: "", label: "Anyone who can approve" },
    ...roles.map((r) => ({ value: r.id, label: r.name })),
  ];

  function save() {
    startTransition(async () => {
      const res = await saveBomFlow({ requiresApproval: required, approverRoleId: roleId });
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Saved");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">How a bill of materials gets published</CardTitle>
        <p className="mt-1 text-caption text-muted-foreground">
          One rule for the whole company. A bill of materials describes a product, so it is not
          set per department the way stock entry approval is.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
          <div className="min-w-0">
            <Label htmlFor="bom-approval" className="text-sm font-medium">
              Needs approval before it counts
            </Label>
            <p className="mt-0.5 text-caption text-muted-foreground">
              {required
                ? "Someone writing a bill of materials submits it, and a manager publishes it. Anyone holding “Publish Without Approval” skips the queue."
                : "Anyone who can write a bill of materials publishes it straight away. Nothing waits."}
            </p>
          </div>
          <Switch
            id="bom-approval"
            checked={required}
            onCheckedChange={(v) => setRequired(v === true)}
          />
        </div>

        {required && (
          <div className="space-y-1.5">
            <Label>Who approves</Label>
            <Select
              value={roleId}
              items={items}
              onValueChange={(v) => setRoleId((v as string) ?? "")}
            >
              <SelectTrigger className="max-w-sm">
                <SelectValue placeholder="Anyone who can approve" />
              </SelectTrigger>
              <SelectContent>
                {items.map((i) => (
                  <SelectItem key={i.value || "any"} value={i.value}>
                    {i.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-micro text-muted-foreground">
              Naming a role that does not hold “bom.approve” is refused — it would create a queue
              nobody could clear.
            </p>
          </div>
        )}

        <Button onClick={save} disabled={pending || !dirty}>
          Save
        </Button>
      </CardContent>
    </Card>
  );
}
