import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding type-button whitespace-nowrap transition-[color,background-color,border-color,opacity,transform] duration-[120ms] ease-[cubic-bezier(0.25,0.1,0.25,1)] outline-none select-none focus-visible:border-transparent focus-visible:outline-[length:var(--focus-ring-width)] focus-visible:outline-offset-[var(--focus-ring-offset)] focus-visible:outline-[var(--focus-ring-color)] active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:cursor-not-allowed aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--accent-primary)] text-[var(--text-on-accent)] hover:bg-[var(--accent-primary-hover)] active:bg-[var(--accent-primary-active)] disabled:bg-[var(--bg-active)] disabled:text-[var(--text-disabled)] disabled:opacity-100",
        outline:
          "border-[var(--border-strong)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] active:bg-[var(--bg-active)] aria-expanded:bg-[var(--bg-active)] aria-expanded:text-[var(--text-primary)] disabled:border-[var(--border-subtle)] disabled:text-[var(--text-disabled)] disabled:opacity-100 dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "border border-[var(--border-strong)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] active:bg-[var(--bg-active)] aria-expanded:bg-[var(--bg-active)] disabled:text-[var(--text-disabled)] disabled:opacity-100",
        ghost:
          "hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] active:bg-[var(--bg-active)] aria-expanded:bg-[var(--bg-active)] aria-expanded:text-[var(--text-primary)] disabled:text-[var(--text-disabled)] disabled:opacity-100 dark:hover:bg-muted/50",
        destructive:
          "bg-[color-mix(in_srgb,var(--error)_12%,transparent)] text-[var(--error)] hover:bg-[color-mix(in_srgb,var(--error)_20%,transparent)] active:bg-[color-mix(in_srgb,var(--error)_28%,transparent)] focus-visible:outline-[color-mix(in_srgb,var(--error)_40%,transparent)] disabled:text-[var(--text-disabled)] disabled:bg-[var(--bg-active)] disabled:opacity-100 dark:bg-destructive/20 dark:hover:bg-destructive/30",
        link: "text-[var(--accent-primary)] underline-offset-4 hover:underline disabled:text-[var(--text-disabled)] disabled:no-underline disabled:opacity-100",
      },
      size: {
        default:
          "h-10 gap-2 px-2.5 in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),8px)] px-2 type-caption in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 rounded-[min(var(--radius-md),10px)] px-2.5 in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5",
        lg: "h-11 gap-2 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-10",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),8px)] in-data-[slot=button-group]:rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-8 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-md",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
