import { splitHighlighted } from "@/shared/fuzzy/fuzzyMatch";
import { cn } from "@/lib/utils";

interface HighlightedTextProps {
  text: string;
  indices: number[];
  className?: string;
  matchClassName?: string;
}

export function HighlightedText({
  text,
  indices,
  className,
  matchClassName = "text-accent font-semibold",
}: HighlightedTextProps) {
  const parts = splitHighlighted(text, indices);
  return (
    <span className={className}>
      {parts.map((part, i) => (
        <span key={i} className={cn(part.matched && matchClassName)}>
          {part.text}
        </span>
      ))}
    </span>
  );
}
