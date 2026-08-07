import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

interface WorkbenchSkeletonProps {
  rows?: number;
  className?: string;
  variant?: "list" | "cards" | "editor";
}

/** Consistent loading placeholders across workspaces */
export function WorkbenchSkeleton({
  rows = 6,
  className,
  variant = "list",
}: WorkbenchSkeletonProps) {
  if (variant === "cards") {
    return (
      <div className={cn("grid gap-2 p-3", className)} aria-busy="true">
        {Array.from({ length: Math.min(rows, 4) }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
    );
  }
  if (variant === "editor") {
    return (
      <div className={cn("space-y-2 p-4 font-mono", className)} aria-busy="true">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton
            key={i}
            className="h-3 rounded-sm"
            style={{ width: `${55 + ((i * 17) % 40)}%` }}
          />
        ))}
      </div>
    );
  }
  return (
    <div className={cn("space-y-1.5 p-2", className)} aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-2 px-1">
          <Skeleton className="h-3.5 w-3.5 shrink-0 rounded-sm" />
          <Skeleton
            className="h-3 rounded-sm"
            style={{ width: `${40 + ((i * 13) % 50)}%` }}
          />
        </div>
      ))}
    </div>
  );
}
