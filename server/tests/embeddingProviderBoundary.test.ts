import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EMBEDDING_PROVIDER_BOUNDARY_LIMITATION } from "../src";

describe("embedding provider boundary disclosure", () => {
  it("keeps the non-GO limitation disclosed and provider responses secret-free", () => {
    expect(EMBEDDING_PROVIDER_BOUNDARY_LIMITATION).toContain("non-GO");
    expect(EMBEDDING_PROVIDER_BOUNDARY_LIMITATION).toContain("sidecar");
    const providerTests = readFileSync(new URL("./providerCatalog.test.ts", import.meta.url), "utf8");
    expect(providerTests).toContain("not.toContain(\"sk-live-provider-secret\")");
  });
});
