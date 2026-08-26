/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { computePublicationChangeDigest, createIndexPublicationClient } from "../../platform/operators/indexPublicationClient.mjs";
import { runIndexPublicationCli } from "../../scripts/operators/index-publication.mjs";

const cleanup = [];
const digest = (seed) => `sha256:${seed.repeat(64).slice(0, 64)}`;

afterEach(() => {
  while (cleanup.length > 0) {
    rmSync(cleanup.pop(), { force: true, recursive: true });
  }
});

function fixtureFiles() {
  const dir = mkdtempSync(join(tmpdir(), "lens-index-publication-"));
  cleanup.push(dir);
  const caFile = join(dir, "ca.pem");
  const certFile = join(dir, "cert.pem");
  const keyFile = join(dir, "key.pem");
  const tokenFile = join(dir, "token.txt");
  writeFileSync(caFile, "test-ca");
  writeFileSync(certFile, "test-cert");
  writeFileSync(keyFile, "test-key");
  writeFileSync(tokenFile, "t".repeat(32));
  return { dir, caFile, certFile, keyFile, tokenFile };
}

function clientOptions(overrides = {}) {
  const files = fixtureFiles();
  return {
    endpoint: "https://publication-authority.rag.platform.internal",
    deadlineMs: 250,
    caFile: files.caFile,
    certFile: files.certFile,
    keyFile: files.keyFile,
    tokenFile: files.tokenFile,
    productionMode: true,
    files,
    ...overrides,
  };
}

function jsonResponse(body, status = 200, headers = { "content-type": "application/json" }) {
  return { status, headers, bodyText: JSON.stringify(body) };
}

function writeFence(files, {
  operation,
  plannedPayload,
  target,
  expiresAt = Date.now() + 60_000,
  issuedAt = Date.now() - 1_000,
} = {}) {
  const fenceFile = join(files.dir, `${operation}-fence-${Math.random().toString(16).slice(2)}.json`);
  writeFileSync(fenceFile, JSON.stringify({
    fenceId: `${operation}-fence-001`,
    target,
    operation,
    canonicalPayloadDigest: computePublicationChangeDigest(operation, plannedPayload),
    ticketRef: plannedPayload.change_reference,
    purposeRef: `publication:${operation}`,
    issuedAt,
    expiresAt,
    nonce: `${operation}-nonce-001`,
    signature: "A".repeat(64),
  }));
  return fenceFile;
}

describe("index publication operator client", () => {
  it("rejects public or datastore endpoints before any network call", () => {
    const files = fixtureFiles();
    expect(() => createIndexPublicationClient({
      endpoint: "https://example.com",
      deadlineMs: 250,
      caFile: files.caFile,
      certFile: files.certFile,
      keyFile: files.keyFile,
    })).toThrow(/private IP or \.internal hostname/);
    expect(() => createIndexPublicationClient({
      endpoint: "https://qdrant.platform.internal",
      deadlineMs: 250,
      caFile: files.caFile,
      certFile: files.certFile,
      keyFile: files.keyFile,
    })).toThrow(/must not target a datastore or search engine host/);
  });

  it("requires workload tokens to contain at least 32 bytes when configured", () => {
    const files = fixtureFiles();
    const shortTokenFile = join(files.dir, "short-token.txt");
    writeFileSync(shortTokenFile, "too-short-token");
    expect(() => createIndexPublicationClient({
      endpoint: "https://publication-authority.rag.platform.internal",
      deadlineMs: 250,
      caFile: files.caFile,
      certFile: files.certFile,
      keyFile: files.keyFile,
      tokenFile: shortTokenFile,
    })).toThrow(/at least 32 bytes/);
  });

  it("sends activation only to the publication authority control plane and returns bounded sanitized output", async () => {
    const plannedPayload = {
      corpus_ref: "enterprise-docs",
      expected_visibility_sequence: 7,
      target_generation_ref: "gen-20260821-02",
      source_revision_digest: digest("a"),
      governance_revision_digest: digest("c"),
      searchable_copy_evidence_ref: "copy-proof-001",
      idempotency_key: "activate-0001",
      reason: "promote searchable copy quorum",
      change_reference: "CHG-2401",
    };
    const transport = vi.fn(async (request) => {
      const sent = JSON.parse(request.body);
      expect(String(request.url)).toBe("https://publication-authority.rag.platform.internal/v1/index-publication/activate");
      expect(sent.expected_visibility_sequence).toBe(7);
      expect(sent.idempotency_key).toBe("activate-0001");
      expect(sent.governance_revision_digest).toBe(digest("c"));
      expect(sent.privileged_change_fence.fenceId).toBe("activate-fence-001");
      expect(sent.searchable_copy_evidence_ref).toBe("copy-proof-001");
      expect(sent).not.toHaveProperty("audit_receipt");
      expect(request.headers.authorization).toBe(`Bearer ${"t".repeat(32)}`);
      return jsonResponse({
        status: "activated",
        corpus_ref: "enterprise-docs",
        active_generation_ref: "gen-20260821-02",
        target_generation_ref: "gen-20260821-02",
        previous_visibility_sequence: 7,
        visibility_sequence: 8,
        source_revision_digest: digest("a"),
        governance_revision_digest: digest("c"),
        audit_receipt: "audit:activate:0001",
        audit_ref: "audit:publication:activate:0001",
        token: "must-not-leak",
        privileged_change_fence: { fenceId: "must-not-leak" },
      });
    });
    const options = clientOptions({ transport });
    const fenceFile = writeFence(options.files, {
      operation: "activate",
      plannedPayload,
      target: {
        corpusRef: "enterprise-docs",
        targetGenerationRef: "gen-20260821-02",
      },
    });
    const client = createIndexPublicationClient(options);
    const result = await client.activate({
      corpusRef: "enterprise-docs",
      expectedVisibilitySequence: 7,
      targetGenerationRef: "gen-20260821-02",
      sourceRevisionDigest: digest("a"),
      governanceRevisionDigest: digest("c"),
      searchableCopyEvidenceRef: "copy-proof-001",
      idempotencyKey: "activate-0001",
      reason: "promote searchable copy quorum",
      changeReference: "CHG-2401",
      fenceFile,
    });
    expect(result).toEqual({
      operation: "activate",
      corpus: "enterprise-docs",
      status: "activated",
      active_generation_ref: "gen-20260821-02",
      target_generation_ref: "gen-20260821-02",
      previous_visibility_sequence: 7,
      visibility_sequence: 8,
      source_revision_digest: digest("a"),
      audit_receipt: "audit:activate:0001",
      audit_ref: "audit:publication:activate:0001",
    });
  });

  it("requires CAS, idempotency, and a live privileged change fence for mutating operations", async () => {
    const options = clientOptions({ transport: vi.fn(async () => jsonResponse({ status: "scheduled", corpus_ref: "enterprise-docs", visibility_sequence: 7, audit_receipt: "audit:refeed:0001" })) });
    const client = createIndexPublicationClient(options);
    const refeedFence = writeFence(options.files, {
      operation: "refeed",
      plannedPayload: {
        corpus_ref: "enterprise-docs",
        expected_visibility_sequence: 7,
        target_generation_ref: "gen-20260821-03",
        source_revision_digest: digest("b"),
        governance_revision_digest: digest("d"),
        idempotency_key: "refeed-0001",
        reason: "repair withdrawn chunks",
        change_reference: "CHG-2402",
      },
      target: {
        corpusRef: "enterprise-docs",
        targetGenerationRef: "gen-20260821-03",
      },
    });
    await expect(client.refeed({
      corpusRef: "enterprise-docs",
      expectedVisibilitySequence: 7,
      targetGenerationRef: "gen-20260821-03",
      sourceRevisionDigest: digest("b"),
      governanceRevisionDigest: digest("d"),
      idempotencyKey: "",
      reason: "repair withdrawn chunks",
      changeReference: "CHG-2402",
      fenceFile: refeedFence,
    })).rejects.toThrow(/idempotencyKey is required/i);
    const expiredFenceFile = writeFence(options.files, {
      operation: "rollback",
      plannedPayload: {
        corpus_ref: "enterprise-docs",
        expected_visibility_sequence: 7,
        expected_active_generation_ref: "gen-20260821-02",
        target_generation_ref: "gen-20260820-99",
        source_revision_digest: digest("f"),
        governance_revision_digest: digest("e"),
        searchable_copy_evidence_ref: "copy-proof-rollback-001",
        idempotency_key: "rollback-0001",
        reason: "revert anomaly spike",
        change_reference: "CHG-2403",
      },
      target: {
        corpusRef: "enterprise-docs",
        targetGenerationRef: "gen-20260820-99",
        expectedActiveGenerationRef: "gen-20260821-02",
      },
      issuedAt: Date.now() - 120_000,
      expiresAt: Date.now() - 60_000,
    });
    await expect(client.rollback({
      corpusRef: "enterprise-docs",
      expectedVisibilitySequence: 7,
      expectedActiveGenerationRef: "gen-20260821-02",
      targetGenerationRef: "gen-20260820-99",
      sourceRevisionDigest: digest("f"),
      governanceRevisionDigest: digest("e"),
      searchableCopyEvidenceRef: "copy-proof-rollback-001",
      idempotencyKey: "rollback-0001",
      reason: "revert anomaly spike",
      changeReference: "CHG-2403",
      fenceFile: expiredFenceFile,
    })).rejects.toThrow(/Privileged change fence is expired/i);
  });

  it("fails closed on stale visibility conflicts", async () => {
    const options = clientOptions({
      transport: vi.fn(async () => ({
        status: 409,
        headers: { "content-type": "application/json" },
        bodyText: JSON.stringify({ status: "stale_visibility_sequence" }),
      })),
    });
    const client = createIndexPublicationClient(options);
    const fenceFile = writeFence(options.files, {
      operation: "activate",
      plannedPayload: {
        corpus_ref: "enterprise-docs",
        expected_visibility_sequence: 7,
        target_generation_ref: "gen-20260821-02",
        source_revision_digest: digest("a"),
        governance_revision_digest: digest("c"),
        searchable_copy_evidence_ref: "copy-proof-001",
        idempotency_key: "activate-0002",
        reason: "promote searchable copy quorum",
        change_reference: "CHG-2404",
      },
      target: {
        corpusRef: "enterprise-docs",
        targetGenerationRef: "gen-20260821-02",
      },
    });
    await expect(client.activate({
      corpusRef: "enterprise-docs",
      expectedVisibilitySequence: 7,
      targetGenerationRef: "gen-20260821-02",
      sourceRevisionDigest: digest("a"),
      governanceRevisionDigest: digest("c"),
      searchableCopyEvidenceRef: "copy-proof-001",
      idempotencyKey: "activate-0002",
      reason: "promote searchable copy quorum",
      changeReference: "CHG-2404",
      fenceFile,
    })).rejects.toThrow(/stale or conflicting update/i);
  });

  it("rejects redirects, oversized responses, invalid JSON, and missing audit receipts", async () => {
    const redirectClient = createIndexPublicationClient(clientOptions({
      transport: vi.fn(async () => ({ status: 302, headers: { location: "https://public.example" }, bodyText: "" })),
    }));
    await expect(redirectClient.status({ corpusRef: "enterprise-docs" })).rejects.toThrow(/refuses redirects/i);

    const oversizedClient = createIndexPublicationClient(clientOptions({
      transport: vi.fn(async () => ({
        status: 200,
        headers: { "content-type": "application/json" },
        bodyText: "x".repeat(33 * 1024),
      })),
    }));
    await expect(oversizedClient.status({ corpusRef: "enterprise-docs" })).rejects.toThrow(/exceeded the byte envelope/i);

    const invalidJsonClient = createIndexPublicationClient(clientOptions({
      transport: vi.fn(async () => ({ status: 200, headers: { "content-type": "application/json" }, bodyText: "{" })),
    }));
    await expect(invalidJsonClient.status({ corpusRef: "enterprise-docs" })).rejects.toThrow(/invalid JSON/i);

    const missingAuditClient = createIndexPublicationClient(clientOptions({
      transport: vi.fn(async () => jsonResponse({
        status: "activated",
        corpus_ref: "enterprise-docs",
        active_generation_ref: "gen-20260821-02",
        target_generation_ref: "gen-20260821-02",
        previous_visibility_sequence: 7,
        visibility_sequence: 8,
        source_revision_digest: digest("a"),
      })),
    }));
    const files = fixtureFiles();
    const fenceFile = writeFence(files, {
      operation: "activate",
      plannedPayload: {
        corpus_ref: "enterprise-docs",
        expected_visibility_sequence: 7,
        target_generation_ref: "gen-20260821-02",
        source_revision_digest: digest("a"),
        governance_revision_digest: digest("c"),
        searchable_copy_evidence_ref: "copy-proof-001",
        idempotency_key: "activate-0003",
        reason: "promote searchable copy quorum",
        change_reference: "CHG-2405",
      },
      target: {
        corpusRef: "enterprise-docs",
        targetGenerationRef: "gen-20260821-02",
      },
    });
    await expect(missingAuditClient.activate({
      corpusRef: "enterprise-docs",
      expectedVisibilitySequence: 7,
      targetGenerationRef: "gen-20260821-02",
      sourceRevisionDigest: digest("a"),
      governanceRevisionDigest: digest("c"),
      searchableCopyEvidenceRef: "copy-proof-001",
      idempotencyKey: "activate-0003",
      reason: "promote searchable copy quorum",
      changeReference: "CHG-2405",
      fenceFile,
    })).rejects.toThrow(/must include an Audit receipt/i);
  });

  it("propagates cancellation and deadlines without retrying", async () => {
    const transport = vi.fn(async ({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")), { once: true });
    }));
    const deadlineClient = createIndexPublicationClient(clientOptions({ transport, deadlineMs: 15 }));
    await expect(deadlineClient.status({ corpusRef: "enterprise-docs" })).rejects.toThrow(/deadline elapsed or request was cancelled/i);

    const controller = new AbortController();
    const cancellableClient = createIndexPublicationClient(clientOptions({ transport, deadlineMs: 500 }));
    const pending = cancellableClient.status({ corpusRef: "enterprise-docs", signal: controller.signal });
    controller.abort(new Error("operator cancelled"));
    await expect(pending).rejects.toThrow(/deadline elapsed or request was cancelled/i);
    expect(transport).toHaveBeenCalled();
  });
});

describe("index publication operator CLI", () => {
  it("prints sanitized JSON only", async () => {
    let output = "";
    await runIndexPublicationCli([
      "status",
      "--corpus",
      "enterprise-docs",
    ], {
      env: {
        NODE_ENV: "production",
        LENS_PUBLICATION_AUTHORITY_URL: "https://publication-authority.rag.platform.internal",
        LENS_PUBLICATION_CA_FILE: "C:\\secure\\ca.pem",
        LENS_PUBLICATION_CERT_FILE: "C:\\secure\\cert.pem",
        LENS_PUBLICATION_KEY_FILE: "C:\\secure\\key.pem",
        LENS_PUBLICATION_DEADLINE_MS: "250",
      },
      stdout: { write: (chunk) => { output += String(chunk); return true; } },
      createClient: () => ({
        status: async () => ({
          operation: "status",
          corpus: "enterprise-docs",
          status: "active",
          active_generation_ref: "gen-20260821-02",
          visibility_sequence: 8,
          source_revision_digest: digest("a"),
          token: "must-not-leak",
          privileged_change_fence: { fenceId: "must-not-leak" },
          protected_metadata: { acl: "must-not-leak" },
        }),
      }),
    });
    expect(JSON.parse(output)).toEqual({
      operation: "status",
      corpus: "enterprise-docs",
      status: "active",
      active_generation_ref: "gen-20260821-02",
      visibility_sequence: 8,
      source_revision_digest: digest("a"),
    });
  });
});
