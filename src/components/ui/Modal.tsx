import { X } from "lucide-react";
import { cn } from "../../lib/utils";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}

const SIZES = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

export default function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  size = "md",
}: ModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div
        className="absolute inset-0 animate-fade-in bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={cn(
          "relative max-h-[85vh] w-full animate-scale-in overflow-hidden rounded-lg border border-white/10 bg-surface-1 shadow-float-pop",
          SIZES[size],
        )}
      >
        {(title || subtitle) && (
          <div className="flex items-start justify-between border-b border-white/10 px-5 py-4">
            <div>
              {title && (
                <h2 className="text-base font-semibold text-zinc-100">
                  {title}
                </h2>
              )}
              {subtitle && (
                <p className="mt-0.5 text-[12.5px] text-zinc-500">{subtitle}</p>
              )}
            </div>
            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}