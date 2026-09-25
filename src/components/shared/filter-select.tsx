"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * One labelled filter dropdown.
 *
 * Used by: the stock report and Find Stock, so the two pages narrow a list the
 * same way — a label, a control, and the value it is set to.
 *
 * It replaced rows of chips. Chips read well with two choices and badly with
 * six: they wrap into a block that pushes the table down the page, and there is
 * nothing to tell a reader that a row of pills IS a filter. A dropdown says so
 * by being one, and it stays one line however many categories there are. Counts
 * that used to sit on the chips ride in the option labels instead, so nothing
 * is lost — "Everything (42)".
 *
 * The trigger sizes to its content down to a floor, so a row of these lines up
 * without a long category name being cut off.
 */
export function FilterSelect({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select
        value={value}
        items={options}
        onValueChange={(v) => onChange((v as string) ?? options[0]?.value ?? "")}
      >
        <SelectTrigger className="h-9 w-auto min-w-[10rem] max-w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
