"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { HelpCircle } from "lucide-react";

export interface HowToSection {
  heading?: string;
  steps: Array<{ title: string; description?: string }>;
}

interface Props {
  /** Dialog title, e.g. "How stock entries work" */
  title: string;
  /** Optional one-liner shown under the title */
  intro?: string;
  sections: HowToSection[];
  /** Trigger button label; defaults to "How it works" */
  triggerLabel?: string;
}

/**
 * A lightweight, reusable "How it works" guide. Drop it into any page header
 * to explain a flow in numbered steps without leaving the page.
 */
export function HowTo({ title, intro, sections, triggerLabel = "How it works" }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <HelpCircle className="mr-2 h-4 w-4" />
        {triggerLabel}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          {intro && <p className="text-sm text-muted-foreground">{intro}</p>}
          {sections.map((section, sIdx) => (
            <div key={sIdx} className="space-y-3">
              {section.heading && (
                <h4 className="text-sm font-semibold">{section.heading}</h4>
              )}
              <ol className="space-y-3">
                {section.steps.map((step, idx) => (
                  <li key={idx} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-navy text-xs font-bold text-white">
                      {idx + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{step.title}</p>
                      {step.description && (
                        <p className="text-xs text-muted-foreground">{step.description}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
