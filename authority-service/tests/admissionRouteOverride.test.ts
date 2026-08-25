import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthorityConflictError, AuthorityService, AuthorityValidationError, DefaultContentPolicy, type RouteOverrideAdmissionFields } from "../src/service";
import { AuthorityStore } from "../src/store";
import { OutputBlobCrypto } from "../src/outputCrypto";

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function routeOverride(overrides: Partial<RouteOverrideAdmissionFields> = {}): RouteOverrideAdmissionFields {
  return {
    attemptedRoute: "NO_RETRIEVAL",
    attemptedReasonCode: "creative_request",
    attemptedConfidenceBucket: "HIGH",
    attemptedProfileSelector: undefined,
    effectiveRoute: "SINGLE_RETRIEVAL",
    effectiveProfileSelector: "default",
    groundingRequired: true,
    routePolicyRevision: 3,
    routePolicyDigest: digest("route-policy"),
    allowedProfileSetDigest: digest("profile-set"),
    enforcementOverride: true,
    overrideReason: "grounding_required_violation",
    ...overrides,
  };
}

describe("AuthorityService.admit — item 4 structured route_override provenance", () => {
  let dir: string;
  let store: AuthorityStore;
  let service: AuthorityService;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "authority-route-override-"));
    store = new AuthorityStore(join(dir, "authority.db"));
    service = new AuthorityService(store, new DefaultContentPolicy(), () => 1_000_000, undefined, undefined, new OutputBlobCrypto(randomBytes(32)));
  });

  afterEach(async () => {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects a route_override admission with no route_override fields — a bare kind+digest is not enough", async () => {
    await expect(service.admit({ kind: "route_override", requestId: "req-1", turnId: "turn-1", inputDigest: digest("input"), ragProfileVersion: 1, ragProfileDigest: digest("rag-profile") }))
      .rejects.toThrow(AuthorityValidationError);
  });

  it("rejects route_override fields on a non-route_override admission", async () => {
    await expect(service.admit({ kind: "generation", requestId: "req-2", turnId: "turn-2", inputDigest: digest("input"), ragProfileVersion: 1, ragProfileDigest: digest("rag-profile"), routeOverride: routeOverride() }))
      .rejects.toThrow(AuthorityValidationError);
  });

  it("rejects a route_override missing a required field (route_policy_digest not a sha256 digest)", async () => {
    await expect(service.admit({
      kind: "route_override", requestId: "req-3", turnId: "turn-3", inputDigest: digest("input"), ragProfileVersion: 1, ragProfileDigest: digest("rag-profile"),
      routeOverride: routeOverride({ routePolicyDigest: "not-a-digest" }),
    })).rejects.toThrow(AuthorityValidationError);
  });

  it("admits a well-formed route_override and persists every named field — not a bare kind+digest", async () => {
    const fields = routeOverride();
    const result = await service.admit({ kind: "route_override", requestId: "req-4", turnId: "turn-4", inputDigest: digest("input"), ragProfileVersion: 1, ragProfileDigest: digest("rag-profile"), routeOverride: fields });
    expect(result.routeOverride).toEqual(fields);

    const stored = await store.getAdmission("req-4", "route_override");
    expect(stored?.routeOverrideJson).toBeDefined();
    expect(JSON.parse(stored!.routeOverrideJson!)).toEqual(fields);
  });

  it("idempotent retry with the SAME route_override fields returns the same receipt", async () => {
    const fields = routeOverride();
    const first = await service.admit({ kind: "route_override", requestId: "req-5", turnId: "turn-5", inputDigest: digest("input"), ragProfileVersion: 1, ragProfileDigest: digest("rag-profile"), routeOverride: fields });
    const second = await service.admit({ kind: "route_override", requestId: "req-5", turnId: "turn-5", inputDigest: digest("input"), ragProfileVersion: 1, ragProfileDigest: digest("rag-profile"), routeOverride: fields });
    expect(second.receiptDigest).toBe(first.receiptDigest);
    expect(second.routeOverride).toEqual(fields);
  });

  it("a retry with DIFFERENT route_override provenance conflicts — idempotency covers the structured fields, not just input_digest", async () => {
    await service.admit({ kind: "route_override", requestId: "req-6", turnId: "turn-6", inputDigest: digest("input"), ragProfileVersion: 1, ragProfileDigest: digest("rag-profile"), routeOverride: routeOverride() });
    await expect(service.admit({
      kind: "route_override", requestId: "req-6", turnId: "turn-6", inputDigest: digest("input"), ragProfileVersion: 1, ragProfileDigest: digest("rag-profile"),
      routeOverride: routeOverride({ overrideReason: "grounding_default_unavailable" }),
    })).rejects.toThrow(AuthorityConflictError);
  });
});
