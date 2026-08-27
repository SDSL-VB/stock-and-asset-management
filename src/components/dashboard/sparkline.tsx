import { cn } from "@/lib/utils";

interface SparklineProps {
  /** Oldest value first. Needs at least two points to say anything. */
  data: number[];
  /** Any CSS colour — pass a token, e.g. "var(--status-approved)". */
  color?: string;
  width?: number;
  height?: number;
  className?: string;
}

/**
 * The seven-day trend that sits in the corner of a KPI tile.
 *
 * Bars rather than a line: the "Innings" direction leans on solid blocks of
 * colour, and discrete bars read a daily bucket honestly — a smoothed line
 * implies continuous data we don't have. The most recent bar is full strength
 * and the rest are held back, so "where it ended up" is the thing you see.
 *
 * Pure SVG with no client-side code, so this renders on the server.
 */
export function Sparkline({
  data,
  color = "var(--chart-1)",
  width = 76,
  height = 24,
  className,
}: SparklineProps) {
  if (!data || data.length < 2) return null;

  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;

  const slot = width / data.length;
  const barWidth = Math.max(2, slot - 2);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cn("shrink-0 overflow-visible", className)}
      aria-hidden="true"
      focusable="false"
    >
      {data.map((value, i) => {
        const barHeight = 3 + ((value - min) / span) * (height - 5);
        const isLast = i === data.length - 1;
        return (
          <rect
            key={i}
            x={i * slot}
            y={height - barHeight}
            width={barWidth}
            height={barHeight}
            rx={1.5}
            fill={color}
            opacity={isLast ? 1 : 0.38}
          />
        );
      })}
    </svg>
  );
}
