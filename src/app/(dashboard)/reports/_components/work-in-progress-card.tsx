"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Hammer, Clock } from "lucide-react";

type WipRow = {
  buildId: string;
  buildNumber: string;
  productCode: string;
  productName: string;
  unit: string;
  locationName: string;
  started: number;
  finished: number;
  onFloor: number;
  daysOpen: number;
  tiedUpValue: number | null;
};

interface Props {
  rows: WipRow[];
  totalOnFloor: number;
  tiedUpValue: number | null;
}

function formatCurrency(n: number) {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

/**
 * What is being made right now.
 *
 * Deliberately its own card rather than a line in the stock totals: the goods
 * do not exist yet, so adding them to a stock figure would make that figure
 * wrong. What they *have* consumed is real, which is why the tied-up value is
 * the number worth showing next to them.
 */
export function WorkInProgressCard({ rows, totalOnFloor, tiedUpValue }: Props) {
  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Hammer className="h-4 w-4 text-muted-foreground" />
            On the floor
          </CardTitle>
          <p className="mt-1 text-caption text-muted-foreground">
            Components consumed, goods not finished yet — not counted as stock anywhere.
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold tabular-nums">{totalOnFloor}</p>
          {tiedUpValue !== null && (
            <p className="text-caption text-muted-foreground tabular-nums">
              {formatCurrency(tiedUpValue)} tied up
            </p>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <div className="divide-y border-t">
          {rows.map((r) => (
            <Link
              key={r.buildId}
              href="/builds"
              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 transition-colors hover:bg-muted/50"
            >
              <span className="font-mono text-caption text-muted-foreground">
                {r.buildNumber}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {r.productName}
              </span>
              <span className="text-caption text-muted-foreground">{r.locationName}</span>

              {/* A run open for weeks is the one worth asking about */}
              <Badge
                variant="outline"
                className={cn(
                  "text-micro",
                  r.daysOpen >= 14
                    ? "border-amber-300 bg-amber-50 text-amber-900"
                    : "text-muted-foreground"
                )}
              >
                <Clock className="mr-1 h-3 w-3" />
                {r.daysOpen === 0 ? "today" : `${r.daysOpen}d`}
              </Badge>

              <span className="text-sm tabular-nums">
                <strong>{r.onFloor}</strong> {r.unit}
                {r.finished > 0 && (
                  <span className="text-muted-foreground"> · {r.finished} done</span>
                )}
              </span>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
