/**
 * Windowing helper for large lists without pulling a virtualization library.
 * Use with ScrollArea + absolute row positioning when rendering 500+ rows.
 */
export function getVirtualWindow(
  total: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  overscan = 6,
): { start: number; end: number; offset: number; height: number } {
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visible = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
  const end = Math.min(total, start + visible);
  return {
    start,
    end,
    offset: start * rowHeight,
    height: total * rowHeight,
  };
}
