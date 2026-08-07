import { cn } from "@/lib/utils"

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("wb-shimmer rounded-md bg-secondary/70", className)}
      {...props}
    />
  )
}

export { Skeleton }
