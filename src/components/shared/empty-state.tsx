import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  /**
   * A single emoji. This is the one place emoji is used in the app — an empty
   * state is a human moment, not UI chrome, and a glyph here reads warmer than
   * another grey outline icon. Everything structural uses lucide-react.
   */
  emoji?: string;
  title: string;
  description?: string;
  action?: {
    label: string;
    href: string;
  };
  className?: string;
}

export function EmptyState({
  emoji = "📭",
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "animate-in fade-in zoom-in-95 flex flex-col items-center justify-center gap-3 px-6 py-12 text-center duration-300",
        className
      )}
    >
      <span
        className="text-4xl leading-none grayscale-[0.15]"
        role="img"
        aria-hidden="true"
      >
        {emoji}
      </span>
      <div className="space-y-1">
        <p className="text-h3">{title}</p>
        {description && (
          <p className="mx-auto max-w-sm text-body text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {action && (
        <Button
          render={<Link href={action.href} />}
          nativeButton={false}
          size="sm"
          variant="outline"
          className="mt-1"
        >
          {action.label}
        </Button>
      )}
    </div>
  );
}
