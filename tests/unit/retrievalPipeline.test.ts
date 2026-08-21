import { describe, expect, it, vi } from "vitest";
import { RetrievalService, type RetrievalPdpPort, type RetrievalIndexPort, type AuthorizedContentPort, type RetrievalAuditPort, type PublicationPort, type RetrievalCandidate } from "../../services/retrieval/RetrievalService";
import type { RetrievalRequest } from "../../libs/rag-contracts";

const request: RetrievalRequest = {
  request_id: "req-1",
  turn_id: "turn-1",
  caller_workload_ref: "ai-orchestrator",
  subject_ref: "subject-1",
  session_ref: "session-1",
  device_ref: "device-1",
  application_id: "lens-employee-client",
  query_digest: "sha256:" + "a".repeat(64),
  query_text: "What is the remote-work stipend?",
  purpose_ref: "purpose-1",
  retrieval_class: "enterprise-grounded",
  corpus_ref: "corpus-1",
  mode: "hybrid",
  candidate_limit: 100,
  deadline_at: Date.now() + 60_000,
  cancellation: false,
  bulkhead: "interactive",
  visibility_minimum: 1,
};

interface TestPorts {
  pdp: RetrievalPdpPort;
  indexes: RetrievalIndexPort;
  content: AuthorizedContentPort;
  audit: RetrievalAuditPort;
  publication: PublicationPort;
}

function candidate(versionRef: string, chunkRef: string, rank: number): RetrievalCandidate {
  return {
    resourceRef: `resource:${versionRef}`,
    versionRef,
    chunkRef,
    contentHash: `sha256:${chunkRef}`,
    lane: "lexical",
    rank,
    classificationRef: "internal",
  };
}

function buildPorts(overrides: Partial<TestPorts> = {}): TestPorts {
  const defaults: TestPorts = {
    pdp: {
      authorizeOperation: () => ({ allowed: true, decisionRef: "decision:op", policyRevision: 1 }),
      authorizeBatch: () => ({
        allowedRefs: ["version-a", "version-b"],
        decisionRef: "decision:batch",
        fence: "signed:fence-1",
        revisionDigest: "revisions",
        policyRevision: 1,
        subjectSecurityRevision: 1,
        resourceSecurityRevisionDigest: "sha256:resources",
      }),
    },
    indexes: {
      search: (input) => ({
        indexGeneration: input.indexGeneration,
        visibilitySequence: input.visibilitySequence,
        sourceRevisionDigest: input.sourceRevisionDigest,
        candidates: [candidate("version-a", "chunk-a", 1), candidate("version-b", "chunk-b", 2)],
      }),
    },
    content: {
      fetch: () => [
        { resourceRef: "resource:version-a", versionRef: "version-a", chunkRef: "chunk-a", contentHash: "sha256:chunk-a", text: "alpha", citationAnchor: "doc-a" },
        { resourceRef: "resource:version-b", versionRef: "version-b", chunkRef: "chunk-b", contentHash: "sha256:chunk-b", text: "beta", citationAnchor: "doc-b" },
      ],
    },
    audit: {
      admit: () => ({ receipt: "receipt:1" }),
    },
    publication: {
      activeGeneration: () => ({
        indexGeneration: "index:gen1",
        visibilitySequence: 1,
        sourceRevisionDigest: "sha256:source-1",
      }),
    },
  };
  return { ...defaults, ...overrides };
}

describe("RetrievalService pipeline", () => {
  it("returns a context result with an exact authorization manifest when allowed", async () => {
    const service = new RetrievalService(...Object.values(buildPorts()) as [RetrievalPdpPort, RetrievalIndexPort, AuthorizedContentPort, RetrievalAuditPort, PublicationPort, () => number]);
    const result = await service.retrieve(request);
    expect(result.status).toBe("context");
    if (result.status !== "context") return;
    expect(result.manifest.operation_decision_ref).toBe("decision:op");
    expect(result.manifest.candidate_decision_ref).toBe("decision:batch");
    expect(result.manifest.sources).toHaveLength(2);
    expect(result.sources[0]).toMatchObject({ document_version_ref: "version-a", content_digest: "sha256:chunk-a" });
    expect(result.context_digest).toMatch(/^sha256:/);
  });

  it("returns denied_policy when the operation PDP denies", async () => {
    const ports = buildPorts({
      pdp: { ...buildPorts().pdp, authorizeOperation: () => ({ allowed: false, decisionRef: "decision:deny", policyRevision: 1 }) },
    });
    const service = new RetrievalService(...Object.values(ports) as [RetrievalPdpPort, RetrievalIndexPort, AuthorizedContentPort, RetrievalAuditPort, PublicationPort, () => number]);
    const result = await service.retrieve(request);
    expect(result.status).toBe("denied_policy");
  });

  it("returns no_context when no candidates are allowed", async () => {
    const ports = buildPorts({
      pdp: { ...buildPorts().pdp, authorizeBatch: () => ({ allowedRefs: [], decisionRef: "decision:batch", fence: "", revisionDigest: "revisions", policyRevision: 1, subjectSecurityRevision: 1, resourceSecurityRevisionDigest: "sha256:resources" }) },
    });
    const service = new RetrievalService(...Object.values(ports) as [RetrievalPdpPort, RetrievalIndexPort, AuthorizedContentPort, RetrievalAuditPort, PublicationPort, () => number]);
    const result = await service.retrieve(request);
    expect(result.status).toBe("no_context");
  });

  it("returns no_context when fetched chunks do not match allowed candidates", async () => {
    const ports = buildPorts({
      content: { ...buildPorts().content, fetch: () => [{ resourceRef: "resource:version-x", versionRef: "version-x", chunkRef: "chunk-x", contentHash: "sha256:chunk-x", text: "unexpected", citationAnchor: "doc-x" }] },
    });
    const service = new RetrievalService(...Object.values(ports) as [RetrievalPdpPort, RetrievalIndexPort, AuthorizedContentPort, RetrievalAuditPort, PublicationPort, () => number]);
    const result = await service.retrieve(request);
    expect(result.status).toBe("no_context");
  });

  it("throws OVERLOADED when active request capacity is exhausted", async () => {
    const ports = buildPorts();
    const service = new RetrievalService(...Object.values(ports) as [RetrievalPdpPort, RetrievalIndexPort, AuthorizedContentPort, RetrievalAuditPort, PublicationPort, () => number], () => Date.now(), { maxActiveRequests: 1 });
    const first = service.retrieve(request);
    await expect(service.retrieve(request)).rejects.toMatchObject({ code: "OVERLOADED", retryable: true });
    await first;
  });

  it("throws DEADLINE_EXCEEDED when the deadline has elapsed", async () => {
    const ports = buildPorts();
    const service = new RetrievalService(...Object.values(ports) as [RetrievalPdpPort, RetrievalIndexPort, AuthorizedContentPort, RetrievalAuditPort, PublicationPort, () => number]);
    await expect(service.retrieve({ ...request, deadline_at: Date.now() - 1 })).rejects.toMatchObject({ code: "DEADLINE_EXCEEDED" });
  });

  it("throws CANCELLED when the caller aborts", async () => {
    const ports = buildPorts();
    const service = new RetrievalService(...Object.values(ports) as [RetrievalPdpPort, RetrievalIndexPort, AuthorizedContentPort, RetrievalAuditPort, PublicationPort, () => number]);
    const controller = new AbortController();
    controller.abort();
    await expect(service.retrieve(request, controller.signal)).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("throws AUDIT_UNAVAILABLE when the audit quorum does not admit", async () => {
    const ports = buildPorts({
      audit: { ...buildPorts().audit, admit: () => { throw new Error("quorum down"); } },
    });
    const service = new RetrievalService(...Object.values(ports) as [RetrievalPdpPort, RetrievalIndexPort, AuthorizedContentPort, RetrievalAuditPort, PublicationPort, () => number]);
    await expect(service.retrieve(request)).rejects.toMatchObject({ code: "AUDIT_UNAVAILABLE", retryable: true });
  });

  it("throws OVERLOADED when the context package exceeds its byte bound", async () => {
    const ports = buildPorts({
      content: { ...buildPorts().content, fetch: () => [{ resourceRef: "resource:version-a", versionRef: "version-a", chunkRef: "chunk-a", contentHash: "sha256:chunk-a", text: "x".repeat(70 * 1024), citationAnchor: "doc-a" }] },
    });
    const service = new RetrievalService(...Object.values(ports) as [RetrievalPdpPort, RetrievalIndexPort, AuthorizedContentPort, RetrievalAuditPort, PublicationPort, () => number], () => Date.now(), { maxContextBytes: 64 * 1024 });
    await expect(service.retrieve(request)).rejects.toMatchObject({ code: "OVERLOADED", retryable: true });
  });

  it("deduplicates fused candidates deterministically", async () => {
    const ports = buildPorts({
      indexes: {
        search: (input) => ({
          indexGeneration: input.indexGeneration,
          visibilitySequence: input.visibilitySequence,
          sourceRevisionDigest: input.sourceRevisionDigest,
          candidates: [candidate("version-a", "chunk-a", 5), candidate("version-a", "chunk-a", 1), candidate("version-a", "chunk-a", 3)],
        }),
      },
      pdp: { ...buildPorts().pdp, authorizeBatch: () => ({ allowedRefs: ["version-a"], decisionRef: "decision:batch", fence: "signed:fence-1", revisionDigest: "revisions", policyRevision: 1, subjectSecurityRevision: 1, resourceSecurityRevisionDigest: "sha256:resources" }) },
      content: { ...buildPorts().content, fetch: () => [{ resourceRef: "resource:version-a", versionRef: "version-a", chunkRef: "chunk-a", contentHash: "sha256:chunk-a", text: "alpha", citationAnchor: "doc-a" }] },
    });
    const service = new RetrievalService(...Object.values(ports) as [RetrievalPdpPort, RetrievalIndexPort, AuthorizedContentPort, RetrievalAuditPort, PublicationPort, () => number]);
    const result = await service.retrieve(request);
    expect(result.status).toBe("context");
  });

  it("propagates cancellation and deadline to every authority call", async () => {
    const search = vi.fn((input) => ({
      indexGeneration: input.indexGeneration,
      visibilitySequence: input.visibilitySequence,
      sourceRevisionDigest: input.sourceRevisionDigest,
      candidates: [candidate("version-a", "chunk-a", 1)],
    }));
    const ports = buildPorts({ indexes: { search } });
    const service = new RetrievalService(...Object.values(ports) as [RetrievalPdpPort, RetrievalIndexPort, AuthorizedContentPort, RetrievalAuditPort, PublicationPort, () => number]);
    await service.retrieve(request);
    expect(search).toHaveBeenCalledWith(expect.objectContaining({
      deadlineAt: request.deadline_at,
      signal: expect.any(AbortSignal),
      queryText: request.query_text,
      indexGeneration: "index:gen1",
      visibilitySequence: 1,
      sourceRevisionDigest: "sha256:source-1",
    }));
  });

  it("fails closed when search does not echo the pinned publication generation", async () => {
    const ports = buildPorts({
      indexes: {
        search: () => ({
          indexGeneration: "index:stale",
          visibilitySequence: 1,
          sourceRevisionDigest: "sha256:source-1",
          candidates: [candidate("version-a", "chunk-a", 1)],
        }),
      },
    });
    const service = new RetrievalService(...Object.values(ports) as [RetrievalPdpPort, RetrievalIndexPort, AuthorizedContentPort, RetrievalAuditPort, PublicationPort, () => number]);
    await expect(service.retrieve(request)).rejects.toMatchObject({ code: "STALE_AUTHORITY", retryable: false });
  });

  it("fails closed when search does not echo the pinned source revision digest", async () => {
    const ports = buildPorts({
      indexes: {
        search: () => ({
          indexGeneration: "index:gen1",
          visibilitySequence: 1,
          sourceRevisionDigest: "sha256:stale-source",
          candidates: [candidate("version-a", "chunk-a", 1)],
        }),
      },
    });
    const service = new RetrievalService(...Object.values(ports) as [RetrievalPdpPort, RetrievalIndexPort, AuthorizedContentPort, RetrievalAuditPort, PublicationPort, () => number]);
    await expect(service.retrieve(request)).rejects.toMatchObject({ code: "STALE_AUTHORITY", retryable: false });
  });

  it("sends actual sha256 candidate and allowed digests to PDP and Audit", async () => {
    const authorizeBatch = vi.fn(buildPorts().pdp.authorizeBatch);
    const admit = vi.fn(buildPorts().audit.admit);
    const ports = buildPorts({
      pdp: { ...buildPorts().pdp, authorizeBatch },
      audit: { admit },
    });
    const service = new RetrievalService(...Object.values(ports) as [RetrievalPdpPort, RetrievalIndexPort, AuthorizedContentPort, RetrievalAuditPort, PublicationPort, () => number], () => 10);

    await service.retrieve(request);

    expect(authorizeBatch.mock.calls[0]?.[0].candidateDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(admit.mock.calls[0]?.[0].candidateDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(admit.mock.calls[0]?.[0].allowedDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(admit.mock.calls[0]?.[0].manifestDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(admit.mock.calls[0]?.[0].candidateDigest).not.toContain("version-a");
    expect(admit.mock.calls[0]?.[0].allowedDigest).not.toContain("chunk-a");
  });

  it("changes the manifest digest when immutable manifest authority fields are tampered", async () => {
    const basePorts = buildPorts();
    const sourceRevisionPorts = buildPorts({
      publication: {
        activeGeneration: () => ({ indexGeneration: "index:gen1", visibilitySequence: 1, sourceRevisionDigest: "sha256:source-2" }),
      },
      indexes: {
        search: (input) => ({
          indexGeneration: input.indexGeneration,
          visibilitySequence: input.visibilitySequence,
          sourceRevisionDigest: input.sourceRevisionDigest,
          candidates: [candidate("version-a", "chunk-a", 1), candidate("version-b", "chunk-b", 2)],
        }),
      },
    });
    const policyPorts = buildPorts({
      pdp: {
        ...buildPorts().pdp,
        authorizeBatch: () => ({
          allowedRefs: ["version-a", "version-b"],
          decisionRef: "decision:batch",
          fence: "signed:fence-1",
          revisionDigest: "revisions",
          policyRevision: 2,
          subjectSecurityRevision: 1,
          resourceSecurityRevisionDigest: "sha256:resources",
        }),
      },
    });
    const classificationPorts = buildPorts({
      indexes: {
        search: (input) => ({
          indexGeneration: input.indexGeneration,
          visibilitySequence: input.visibilitySequence,
          sourceRevisionDigest: input.sourceRevisionDigest,
          candidates: [{ ...candidate("version-a", "chunk-a", 1), classificationRef: "confidential" }, candidate("version-b", "chunk-b", 2)],
        }),
      },
    });
    const run = async (ports: TestPorts) => {
      const service = new RetrievalService(...Object.values(ports) as [RetrievalPdpPort, RetrievalIndexPort, AuthorizedContentPort, RetrievalAuditPort, PublicationPort, () => number], () => 10);
      const result = await service.retrieve(request);
      if (result.status !== "context") throw new Error("expected context");
      return result.manifest.digest;
    };

    const baseDigest = await run(basePorts);

    expect(await run(sourceRevisionPorts)).not.toBe(baseDigest);
    expect(await run(policyPorts)).not.toBe(baseDigest);
    expect(await run(classificationPorts)).not.toBe(baseDigest);
  });

  it("counts context envelopes using UTF-8 bytes", async () => {
    const ports = buildPorts({
      pdp: { ...buildPorts().pdp, authorizeBatch: () => ({ allowedRefs: ["version-a"], decisionRef: "decision:batch", fence: "signed:fence-1", revisionDigest: "revisions", policyRevision: 1, subjectSecurityRevision: 1, resourceSecurityRevisionDigest: "sha256:resources" }) },
      content: { fetch: () => [{ resourceRef: "resource:version-a", versionRef: "version-a", chunkRef: "chunk-a", contentHash: "sha256:chunk-a", text: "😀".repeat(20), citationAnchor: "doc-a" }] },
    });
    const service = new RetrievalService(...Object.values(ports) as [RetrievalPdpPort, RetrievalIndexPort, AuthorizedContentPort, RetrievalAuditPort, PublicationPort, () => number], () => 10, { maxContextBytes: 79 });
    await expect(service.retrieve(request)).rejects.toMatchObject({ code: "OVERLOADED", retryable: true });
  });

  it("does not fetch protected content before batch authorization allows", async () => {
    const fetch = vi.fn(buildPorts().content.fetch);
    const ports = buildPorts({
      pdp: {
        ...buildPorts().pdp,
        authorizeBatch: () => ({ allowedRefs: [], decisionRef: "decision:batch", fence: "", revisionDigest: "revisions", policyRevision: 1, subjectSecurityRevision: 1, resourceSecurityRevisionDigest: "sha256:resources" }),
      },
      content: { fetch },
    });
    const service = new RetrievalService(...Object.values(ports) as [RetrievalPdpPort, RetrievalIndexPort, AuthorizedContentPort, RetrievalAuditPort, PublicationPort, () => number]);
    await expect(service.retrieve(request)).resolves.toEqual({ status: "no_context" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
