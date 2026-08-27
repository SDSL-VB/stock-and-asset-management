import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { HoverLift } from "@/components/motion";
import { toneStyles, type StatusTone } from "@/lib/design/status";

interface QuickActionCardProps {
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
  tone?: StatusTone;
}

export function QuickActionCard({
  label,
  description,
  href,
  icon: Icon,
  tone = "info",
}: QuickActionCardProps) {
  const accent = toneStyles(tone).cssVar;

  return (
    <HoverLift className="h-full">
      <Link
        href={href}
        className="block h-full rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
      >
        <Card interactive className="group/qa h-full">
          <CardContent className="flex flex-col items-center gap-3 py-2 text-center">
            <div
              className="flex size-12 items-center justify-center rounded-xl transition-transform duration-200 ease-out-quart group-hover/qa:scale-110"
              style={{
                backgroundColor: `color-mix(in srgb, ${accent} 14%, transparent)`,
                color: accent,
              }}
            >
              <Icon className="size-6" />
            </div>
            <div>
              <p className="text-h3">{label}</p>
              <p className="mt-0.5 text-caption text-muted-foreground">
                {description}
              </p>
            </div>
          </CardContent>
        </Card>
      </Link>
    </HoverLift>
  );
}
