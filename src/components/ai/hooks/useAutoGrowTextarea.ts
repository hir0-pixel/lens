import { useCallback, useRef } from "react";

export function useAutoGrowTextarea(maxHeight = 200) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const adjust = useCallback(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, maxHeight)}px`;
  }, [maxHeight]);

  const reset = useCallback(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.style.height = "auto";
  }, []);

  return { ref, adjust, reset };
}
