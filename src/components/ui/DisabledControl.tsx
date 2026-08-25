import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface DisabledControlProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "disabled"> {
  reason: string;
  children: ReactNode;
}

/** Outcome B — looks disabled, explains why on hover. */
export function DisabledControl({
  reason,
  children,
  className,
  ...rest
}: DisabledControlProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            disabled
            aria-disabled
            title={reason}
            className={cn("cursor-not-allowed opacity-50", className)}
            {...rest}
          >
            {children}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[220px] type-caption">
          {reason}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
