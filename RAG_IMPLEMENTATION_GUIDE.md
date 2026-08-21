# Sovereign RAG Implementation Guide

| | |
|---|---|
| Audience | Backend, retrieval, platform and security engineers |
| Status | Implementation companion to Documents 001-025 |
| Scope | Governed enterprise document retrieval for the Lens assistant |

This guide explains how to implement RAG in Lens. It does not replace the contracts in Documents 003, 004, 005, 006, 007, 009, 016, 021, 024 and 025. When this guide conflicts with an architecture document, stop and resolve the conflict with an ADR before coding.

## Runtime Request Path

The UI calls only the company-controlled BFF/API Gateway. It never calls Qdrant, an embedding service, the Retrieval Service, a model runtime or a model provider directly.

```text
UI -> API Gateway/BFF -> AI Orchestrator -> live PDP operation decision
   -> Hybrid Retrieval Service
      -> bounded lexical + vector + optional graph search
      -> batch live candidate authorization using Governance facts
      -> protected chunk fetch by immutable reference
      -> rerank authorized text only
   -> generation-start context-fence revalidation
   -> Model Gateway -> Scheduler -> internal inference pool
   -> output/disclosure/audit gates -> durable turn commit -> UI
```

API scaling is server-side. The client submits a request, displays explicit status, handles cancellation and fetches the durable final result. It does not implement retrieval, authorization, model selection or retry logic.

## Ingestion Pipeline

Implement bounded, durable, idempotent workers for:

1. Immutable `document_version` creation using a content digest.
2. Size/type/malware/archive validation.
3. Parsing and OCR inside the approved untrusted-content sandbox.
4. Deterministic chunking with source offsets and profile digest.
5. Embedding with an approved internal embedding profile; record model/tokenizer/schema digests.
6. Lexical/vector/graph index writes containing references and search metadata only. Never store protected chunk text in index payloads.
7. Immutable encrypted chunk storage in the sovereign content store.
8. Generation verification and atomic publication through the independent publication manifest.
9. Transactional-outbox lineage and invalidation events.

At-least-once workers are acceptable when effects are idempotent by source version, stage, profile and generation. A partial generation is never visible to Retrieval.

## Retrieval Service

Retrieval is stateless and accepts calls only from the Orchestrator using workload identity and mTLS. For every request:

1. Validate trusted identity context, deadline, query limits and retrieval class.
2. Obtain the live PDP operation decision; fail closed if PDP or Governance is unavailable.
3. Resolve one active publication-manifest snapshot; never mix index generations.
4. Run bounded lexical and dense search, fuse deterministically, and cap candidates and bytes.
5. Batch-authorize exact resource/version/chunk references against one Governance revision.
6. Fetch protected text only for allowed immutable references and verify its digest.
7. Rerank authorized text only; build citations, lineage and the authorization manifest.
8. Revalidate the unexpired context fence at generation start and every tool boundary.
9. Admit protected context to Audit before returning it to the Orchestrator.

Return an authorized versioned context package or an externally indistinguishable `no_context` result. Never disclose denied IDs, ACLs, candidate counts, policy reasons or existence information.

## Required Contracts

Requests carry server-generated `request_id`, `turn_id`, `retrieval_id`, trusted subject/session/device/workload references, canonical query, purpose, retrieval class, approved filters, capability request, absolute deadline, cancellation, bounded retry budget, schema version and bulkhead identity.

The client cannot provide identity, roles, ACLs, policy decisions, authorization manifests, index generations, model endpoints or internal URLs. Retrieval returns only authorized immutable references, protected text, exact source lineage, citations, security revisions, expiry, decision-fence reference and a complete-context digest.

## Security and Failure Rules

- No cloud model, external embedding API, public search service or internet fallback.
- Index metadata and caches are hints; live authorization is authoritative.
- Every stage has deadlines, cancellation propagation, fixed concurrency and bounded memory/bytes.
- Saturation returns typed `429`/`503`; it never creates an unbounded hidden queue.
- Generation is not automatically retried. Ingestion retries only idempotent work.
- Revocation, stale fences, digest mismatch, authority outage or failed audit admission releases no protected context.
- Logs and telemetry contain references/digests, never raw queries, chunks, prompts, outputs, cookies or tokens.
- Retrieval cannot invoke inference, write conversations or decide authorization.

## Build Order and Acceptance

1. Version contracts, typed errors, deadlines, cancellation and conformance fixtures.
2. Route the BFF to the Orchestrator and remove direct local-RAG/provider calls.
3. Implement operation authorization, publication resolution, bounded search and candidate authorization.
4. Add protected content fetch, digest verification, citations and context fencing.
5. Connect prompt composition to the Model Gateway and GPU scheduler.
6. Add ingestion workers, outbox, publication, withdrawal and invalidation.
7. Add distributed limits, bulkheads, audit, telemetry, deployment and recovery controls.
8. Prove with tests and deployment evidence that unauthorized clients cannot reach internal services, revocation prevents retrieval, generations never mix, outages fail closed, cancellation stops work, overload stays bounded, and production artifacts contain no external endpoint or runtime model download path.

For ownership and exact semantics, use Documents 001-025, `PRODUCTION_RAG_IMPLEMENTATION_PLAN.md`, `contracts/rag/` and `delivery/04-api-and-event-specification.md` as the authoritative references.
