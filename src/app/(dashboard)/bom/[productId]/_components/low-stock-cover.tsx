"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BellRing, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setBomLowStockBuilds } from "@/lib/actions/bom";

/**
 * "Keep enough for N builds" — the low-stock cover of this product's BOM.
 *
 * Every component is watched automatically at the sites that build this
 * product (see src/lib/low-stock-bom.ts), with a minimum of quantity per unit ×
 * N. Changing N here updates those watches straight away. A minimum someone set
 * by hand on the low-stock card is theirs and is left alone.
 */
export function LowStockCover({
  productId,
  builds,
  canSet,
}: {
  productId: string;
  builds: number;
  canSet: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(String(builds));
  const [saving, startSaving] = useTransition();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <BellRing className="h-4 w-4" />
          Low-stock cover
        </CardTitle>
        <p className="text-caption text-muted-foreground">
          Every component is watched for low stock at the sites that build this product. Its
          minimum is what this many builds need.
        </p>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="cover-builds">Keep enough for</Label>
          <div className="flex items-center gap-2">
            <Input
              id="cover-builds"
              type="number"
              min={1}
              step={1}
              value={value}
              disabled={!canSet}
              onChange={(e) => setValue(e.target.value)}
              className="w-24 tabular-nums"
            />
            <span className="text-sm">build{value === "1" ? "" : "s"}</span>
          </div>
        </div>
        {canSet && (
          <Button
            variant="outline"
            disabled={saving || value === String(builds) || !(Number(value) >= 1)}
            onClick={() =>
              startSaving(async () => {
                const res = await setBomLowStockBuilds(productId, Number(value));
                if ("error" in res) {
                  toast.error(res.error);
                  return;
                }
                toast.success(`Components now kept for ${value} build${value === "1" ? "" : "s"}`);
                router.refresh();
              })
            }
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save cover
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
