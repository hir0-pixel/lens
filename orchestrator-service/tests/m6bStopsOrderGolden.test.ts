import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M5 established the hook-binding order in `agentHarness.ts`'s `stops` array: governance
 * (M1) registers before the envelope-reservation hook, which registers before the context (M4)
 * envelope hook, which registers before the model transport binds. M6b extends the *content* of
 * `resolveIntent` and the envelope hook's tool-name lookup (to cover MCP tools additively) but
 * must not reorder or add/remove entries in this array — a golden, source-level proof that it
 * didn't, independent of the harness's runtime hook-dispatch internals (which are opaque to a
 * test and belong to `@earendil-works/pi-agent-core`, not this repo).
 */
describe("agentHarness.ts stops array order (golden, M6b)", () => {
  it("golden.stops-array-order: the M5 binding order is byte-identical", () => {
    const source = readFileSync(join(__dirname, "../src/agentHarness.ts"), "utf8");
    const start = source.indexOf("const stops = [");
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf("\n      ];", start);
    expect(end).toBeGreaterThan(start);
    const stopsBlock = source.slice(start, end);

    const ENTRY_MARKERS = [
      "bindCompactionDecline",
      "bindToolGovernance",
      'harness.hooks.on("before_tool"',
      "bindContextAuthorization",
      "transport.bind",
      'harness.hooks.on("after_response"',
    ] as const;

    const order = [...stopsBlock.matchAll(/^\s{8}(bindCompactionDecline\(|bindToolGovernance\(|harness\.hooks\.on\("before_tool"|bindContextAuthorization\(|transport\.bind\(|harness\.hooks\.on\("after_response")/gm)]
      .map((match) => match[1]!.replace(/\($/, ""));

    expect(order).toEqual(ENTRY_MARKERS.map((marker) => marker.replace(/\($/, "")));
    // Exactly six top-level entries — nothing inserted, nothing removed.
    expect(order).toHaveLength(6);
  });
});
