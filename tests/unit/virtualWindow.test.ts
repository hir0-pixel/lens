import { describe, expect, it } from "vitest";
import { getVirtualWindow } from "@/shared/performance/virtualWindow";

describe("getVirtualWindow", () => {
  it("computes a stable window with overscan", () => {
    const w = getVirtualWindow(1000, 400, 200, 20, 2);
    expect(w.start).toBe(18);
    expect(w.end).toBe(32);
    expect(w.offset).toBe(18 * 20);
    expect(w.height).toBe(20_000);
  });
});
