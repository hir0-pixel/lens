import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-2.5 py-2 text-base text-[var(--text-primary)] transition-colors duration-[120ms] ease-[cubic-bezier(0.25,0.1,0.25,1)] outline-none placeholder:text-[var(--text-tertiary)] hover:border-[var(--border-strong)] focus-visible:border-[var(--border-strong)] focus-visible:outline-[length:var(--focus-ring-width)] focus-visible:outline-offset-[var(--focus-ring-offset)] focus-visible:outline-[var(--focus-ring-color)] disabled:cursor-not-allowed disabled:border-[var(--border-subtle)] disabled:bg-[#f2f2f2] disabled:text-[var(--text-disabled)] disabled:opacity-100 aria-invalid:border-destructive md:text-sm dark:bg-input/30 dark:aria-invalid:border-destructive/50",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
