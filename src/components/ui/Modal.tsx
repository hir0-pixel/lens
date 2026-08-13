import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}

const SIZES = {
  sm: "sm:max-w-md",
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
  xl: "sm:max-w-4xl",
};

/** Compatibility wrapper backed by the installed shadcn Dialog primitive. */
export default function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  size = "md",
}: ModalProps) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className={`max-h-[85vh] gap-0 overflow-hidden p-0 ${SIZES[size]}`}>
        {(title || subtitle) && (
          <DialogHeader className="border-b border-border px-5 py-3 pr-12">
            {title && <DialogTitle className="text-[15px]">{title}</DialogTitle>}
            {subtitle && (
              <DialogDescription className="mt-0.5 text-[12px]">
                {subtitle}
              </DialogDescription>
            )}
          </DialogHeader>
        )}
        <div className="max-h-[calc(85vh-5rem)] overflow-y-auto">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
