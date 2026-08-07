import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type Axis = "horizontal" | "vertical";

interface PanelSashProps {
  axis: Axis;
  /**
   * Absolute pointer position in viewport coords (clientX or clientY).
   * Prefer this for 1:1 tracking without delta drift.
   */
  onResizeTo: (clientPos: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onDoubleClick?: () => void;
  className?: string;
  "aria-label"?: string;
}

/**
 * 4px drag handle — tracks pointer 1:1, no CSS transition while dragging.
 */
export function PanelSash({
  axis,
  onResizeTo,
  onDragStart,
  onDragEnd,
  onDoubleClick,
  className,
  "aria-label": ariaLabel,
}: PanelSashProps) {
  const dragging = useRef(false);
  const [active, setActive] = useState(false);

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!dragging.current) return;
      onResizeTo(axis === "horizontal" ? e.clientX : e.clientY);
    },
    [axis, onResizeTo],
  );

  const endDrag = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    setActive(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    onDragEnd?.();
  }, [onDragEnd]);

  useEffect(() => {
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    };
  }, [onPointerMove, endDrag]);

  return (
    <div
      role="separator"
      aria-orientation={axis === "horizontal" ? "vertical" : "horizontal"}
      aria-label={ariaLabel ?? "Resize panel"}
      tabIndex={0}
      onPointerDown={(e) => {
        e.preventDefault();
        dragging.current = true;
        setActive(true);
        document.body.style.cursor =
          axis === "horizontal" ? "col-resize" : "row-resize";
        document.body.style.userSelect = "none";
        onDragStart?.();
        onResizeTo(axis === "horizontal" ? e.clientX : e.clientY);
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }}
      onDoubleClick={onDoubleClick}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 40 : 12;
        /* Keyboard nudges use approximate positions via current store — handled by parent if needed */
        if (axis === "horizontal") {
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            onResizeTo(
              (e.currentTarget.getBoundingClientRect().left) - step,
            );
          }
          if (e.key === "ArrowRight") {
            e.preventDefault();
            onResizeTo(
              (e.currentTarget.getBoundingClientRect().left) + step,
            );
          }
        } else {
          if (e.key === "ArrowUp") {
            e.preventDefault();
            onResizeTo(
              (e.currentTarget.getBoundingClientRect().top) - step,
            );
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            onResizeTo(
              (e.currentTarget.getBoundingClientRect().top) + step,
            );
          }
        }
      }}
      className={cn(
        "panel-sash shrink-0",
        axis === "horizontal" && "w-1 cursor-col-resize self-stretch",
        axis === "vertical" && "h-1 w-full cursor-row-resize",
        active && "panel-sash-active",
        className,
      )}
    />
  );
}
