import { describe, expect, it } from "vitest";
import { fuzzyMatch, fuzzyFilter } from "@/shared/fuzzy/fuzzyMatch";

describe("fuzzyMatch", () => {
  it("matches subsequence query characters", () => {
    const m = fuzzyMatch("ash", "AppShell.tsx");
    expect(m).not.toBeNull();
    expect(m!.indices.length).toBe(3);
  });

  it("returns null when query is not a subsequence", () => {
    expect(fuzzyMatch("zzz", "hello")).toBeNull();
  });

  it("returns empty match for empty query", () => {
    expect(fuzzyMatch("", "anything")).toEqual({ score: 0, indices: [] });
  });

  it("returns all matching paths for a common token", () => {
    const items = [
      { path: "src/shared/utils.ts" },
      { path: "src/components/utils/index.ts" },
      { path: "utils.ts" },
    ];
    const ranked = fuzzyFilter(items, "utils", (i) => i.path, 10);
    expect(ranked.map((r) => r.path)).toContain("utils.ts");
    expect(ranked.length).toBe(3);
    expect(ranked[0]._fuzzyScore).toBeGreaterThanOrEqual(ranked[1]._fuzzyScore);
  });
});
