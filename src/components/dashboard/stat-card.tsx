import Link from "next/link";
import type { CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Sparkline } from "@/components/dashboard/sparkline";
import { CountUp, HoverLift } from "@/components/motion";
import { toneStyles, type StatusTone } from "@/lib/design/status";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon: LucideIcon;
  /**
   * Drives the whole tile's colour. Defaults to `info`, which is the
   * accessible blue — note it is deliberately not the raw brand blue
   * (#00AEEF), which is a fill colour and too light to read as text.
   */
  tone?: StatusTone;
  /** Seven daily buckets from getDashboardTrends(). Omit and no spark renders. */
  trend?: number[];
  /** Percent change vs the previous window. Omit and no delta renders. */
  deltaPct?: number | null;
  /** Formats a numeric value as INR while counting up. */
  currency?: boolean;
  /** Makes the whole tile a link. */
  href?: string;
}

/**
 * The "Innings" KPI tile: the whole surface is washed in the status colour
 * rather than carrying a thin accent stripe, with the 7-day shape in the
 * corner and the change against the previous week beneath the number.
 *
 * Trend and delta are both optional on purpose — a tile with no real
 * time-series behind it renders without them rather than inventing a shape.
 */
export function StatCard({
  title,
  value,
  description,
  icon: Icon,
  tone = "info",
  trend,
  deltaPct,
  currency = false,
  href,
}: StatCardProps) {
  const accent = toneStyles(tone).cssVar;

  const delta =
    typeof deltaPct === "number" && Number.isFinite(deltaPct) ? deltaPct : null;
  const direction = delta === null ? "flat" : delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const DeltaIcon =
    direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : ArrowRight;

  const hasSpark = Array.isArray(trend) && trend.length > 1;

  const tile = (
    <Card
      className={cn("kpi-tile h-full", href && "hover:shadow-lg")}
      style={{ "--k": accent } as CSSProperties}
    >
      <CardContent className="flex h-full flex-col justify-between gap-3">
        <div className="flex items-start justify-between gap-3">
          <p
            className="text-caption font-semibold"
            style={{
              color: `color-mix(in srgb, ${accent} 55%, var(--muted-foreground))`,
            }}
          >
            {title}
          </p>
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-lg"
            style={{
              backgroundColor: `color-mix(in srgb, ${accent} 18%, transparent)`,
              color: accent,
            }}
          >
            <Icon className="size-4" />
          </span>
        </div>

        <div>
          <p
            data-slot="stat-value"
            className="text-h1 leading-none"
            style={{
              color: `color-mix(in srgb, ${accent} 72%, var(--card-foreground))`,
            }}
          >
            {typeof value === "number" ? (
              <CountUp value={value} currency={currency} />
            ) : (
              value
            )}
          </p>
          {description && (
            <p className="mt-1.5 text-micro text-muted-foreground">
              {description}
            </p>
          )}
        </div>

        {(delta !== null || hasSpark) && (
          <div className="flex items-end justify-between gap-3">
            {delta !== null ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-micro font-bold tabular-nums",
                  direction === "up" && "text-status-approved",
                  direction === "down" && "text-status-rejected",
                  direction === "flat" && "text-muted-foreground"
                )}
              >
                <DeltaIcon className="size-3" />
                {delta > 0 ? "+" : ""}
                {delta}%
                <span className="font-medium text-muted-foreground">
                  vs last week
                </span>
              </span>
            ) : (
              <span aria-hidden="true" />
            )}
            {hasSpark && <Sparkline data={trend} color={accent} />}
          </div>
        )}
      </CardContent>
    </Card>
  );

  if (!href) return tile;

  return (
    <HoverLift className="h-full">
      <Link
        href={href}
        className="block h-full rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
      >
        {tile}
      </Link>
    </HoverLift>
  );
}
