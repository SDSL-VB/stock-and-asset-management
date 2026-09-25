import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: string;
  /** Actions rendered on the trailing edge — usually the page's primary CTA. */
  children?: React.ReactNode;
  /** Shows a back link above the title. */
  backHref?: string;
  backLabel?: string;
  /** Hides the hairline rule, for pages that immediately follow with a card. */
  divider?: boolean;
  className?: string;
}

export function PageHeader({
  title,
  description,
  children,
  backHref,
  backLabel = "Back",
  divider = true,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("space-y-4", className)}>
      {backHref && (
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 text-caption font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-200 ease-out-quart group-hover:-translate-x-0.5" />
          {backLabel}
        </Link>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-h1">{title}</h1>
          {description && (
            <p className="mt-1 text-body text-muted-foreground">{description}</p>
          )}
        </div>
        {/* Wraps, and does not shrink the title to make room: pages here
            carry three or four actions, and on a narrow screen they belong on
            a second line rather than off the edge of it. */}
        {children && (
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">{children}</div>
        )}
      </div>

      {divider && <hr className="border-border" />}
    </div>
  );
}
