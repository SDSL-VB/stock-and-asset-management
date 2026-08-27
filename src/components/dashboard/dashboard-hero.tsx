import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface DashboardHeroProps {
  /** Already includes the person's first name, e.g. "Good morning, Phani 👋". */
  greeting: string;
  description?: string;
  /** A single live number worth surfacing above everything else. */
  highlight?: {
    label: string;
    /** Pulses the dot when there's something actually waiting on the user. */
    urgent?: boolean;
    /** Makes the pill a link — e.g. straight to the one item awaiting review. */
    href?: string;
  };
  action?: {
    label: string;
    href: string;
  };
  className?: string;
}

/**
 * The banner at the top of every role dashboard.
 *
 * This block used to be copy-pasted into all five role dashboards as an
 * identical `bg-gradient-to-r from-brand-navy to-brand-navy-light` div, so
 * changing the treatment meant editing five files. The gradient itself now
 * lives in globals.css as `.brand-hero`.
 */
export function DashboardHero({
  greeting,
  description,
  highlight,
  action,
  className,
}: DashboardHeroProps) {
  return (
    <div
      className={cn(
        "brand-hero rounded-xl px-6 py-6 text-white shadow-md sm:px-7",
        className
      )}
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-h1 text-balance text-white">{greeting}</h1>
          {description && (
            <p className="mt-1.5 text-body text-white/70">{description}</p>
          )}

          {highlight &&
            (() => {
              const pill = (
                <>
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full bg-brand-green",
                      highlight.urgent && "animate-pulse-ring"
                    )}
                  />
                  {highlight.label}
                </>
              );
              const pillClass =
                "mt-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-caption font-semibold text-white/90 backdrop-blur-sm";
              return highlight.href ? (
                <Link
                  href={highlight.href}
                  className={cn(
                    pillClass,
                    "transition-colors duration-200 hover:border-white/30 hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
                  )}
                >
                  {pill}
                  <ArrowRight className="size-3.5" />
                </Link>
              ) : (
                <span className={pillClass}>{pill}</span>
              );
            })()}
        </div>

        {action && (
          <Link
            href={action.href}
            className="group inline-flex shrink-0 items-center gap-2 self-start rounded-lg bg-brand-green px-4 py-2.5 text-body font-bold text-brand-navy shadow-sm transition-all duration-200 ease-out-quart hover:-translate-y-0.5 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-brand-navy focus-visible:outline-none sm:self-auto"
          >
            {action.label}
            <ArrowRight className="size-4 transition-transform duration-200 ease-out-quart group-hover:translate-x-0.5" />
          </Link>
        )}
      </div>
    </div>
  );
}
