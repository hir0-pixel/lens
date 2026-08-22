# Enterprise Policy RAG Design

## Status and scope

This design governs a document-grounded assistant for approved company-policy corpora. It does not ship, infer, or fabricate Google-internal policy content. Policy owners must supply the authoritative `.md` or `.txt` corpus and its access rules.

The design was reconciled against system-design documents 001-025 and delivery documents 01-10 under `refactr system design/sys des/sys des`. Documents 004, 005, 006, 007, 009, 010, 011, 016, 017, 020, 021, 022, 023, 024 and 025 are binding for the RAG path.

## Requirements and assumptions

Functional requirements:

1. Ingest immutable, versioned policy documents with deterministic chunks and content digests.
2. Retrieve bounded relevant evidence before generation and return exact citations.
3. Apply fresh subject/corpus authorization before protected content fetch and again before generation.
4. Use the exact Gemini text model selected by the authenticated user.
5. Abstain without calling the model when approved documents do not contain sufficient evidence.

Non-functional requirements:

- Canonical scale: 10,000+ employees, 1,000+ concurrent generating sessions; acceptance floor of 1,300 concurrent generations and 500 accepted new requests/s.
- Availability target: 99.9% for the initial interactive profile; security, authorization, audit, and disclosure invariants never fail open.
- Request path: absolute deadlines and cancellation; no unbounded synchronous queue.
- Retrieval target for the production profile: measure p50/p95/p99 at 100, 500, and 1,000 candidates. A numerical latency SLO is admitted only from production-like corpus and hardware evidence.
- Capacity inputs still required from the policy owner: corpus bytes, document/chunk count, daily change rate, language mix, OCR ratio, query distribution, and retention horizon.

Back-of-envelope serving envelope from the canonical acceptance profile:

- Average interactive starts at 1,300 concurrent requests and a 30-second mean duration: about 43 starts/s.
- Five-minute burst: at least 86 starts/s.
- Gateway admission campaign: 500 accepted requests/s, independently of expensive generation admission.
- Storage formula: `(source bytes + chunk/index amplification + embeddings + metadata) * replication factor`; procurement is blocked until the missing corpus measurements are supplied.

## Architecture

```text
Desktop
  -> authenticated BFF / admission limits
  -> stateless RAG coordinator
       -> policy authorization
       -> immutable corpus snapshot / retrieval index
       -> bounded hybrid retrieval + relevance gate
       -> context-use authorization fence
       -> selected Gemini model gateway
       -> output grounding / citation validation
       -> audit admission and durable turn finalization
  -> answer + exact citations, or deterministic no-evidence abstention

Asynchronous path:
policy source -> isolated parser -> deterministic chunks -> embeddings/index lanes
              -> immutable generation verification -> atomic publication pointer
              -> cache invalidation event/outbox
```

The local desktop implementation is a single-process reference slice: file-backed immutable corpus snapshot, precomputed lexical index, bounded retrieval, abstention, and Gemini composition. Production replaces local authorization/audit/storage ports with the authoritative services defined by Documents 005, 016, 021, and 025. Local allow rules are forbidden in production.

## Retrieval and latency decisions

- Tokenize and index once per immutable corpus generation; never tokenize the entire corpus per query.
- Run independent lexical and vector lanes concurrently in production, merge with deterministic reciprocal-rank fusion, and optionally rerank only the small authorized candidate set.
- Cache immutable index objects and query-to-candidate references by corpus generation. Never cache a final authorization decision or protected generated response.
- Batch candidate authorization, then fetch exact immutable bytes only for allowed references.
- Use hard top-k, context-byte, file-byte, corpus-byte, and deadline limits.
- Coalesce concurrent snapshot refreshes and apply bounded TTL/fingerprint checks to avoid refresh stampedes.
- Do not invoke Gemini on `no_context`; this is both the largest latency/cost win for irrelevant questions and the required hallucination control.
- Generate with a strict context-as-data instruction and validate citations against the supplied source manifest.

## Security and Google alignment

Google's Secure AI Framework informs secure-by-default controls, threat detection, consistent platform controls, adaptive mitigations, and business-risk context. Google's Zanzibar paper informs revision-bound, causally consistent authorization checks. Google Cloud's RAG reference architecture informs separation of ingestion, retrieval/index, and generation responsibilities.

References:

- https://safety.google/safety/saif/
- https://research.google/pubs/zanzibar-googles-consistent-global-authorization-system/
- https://docs.cloud.google.com/architecture/rag-reference-architectures
- https://ai.google.dev/gemini-api/docs/safety-guidance

Retrieved policy text is untrusted input even after authorization. Document instructions cannot override the system policy. Secrets, raw prompts, document text, and model output must not enter ordinary telemetry.

## Sovereign baseline conflict and deployment profiles

Document 001 ADR-004 prohibits every public inference call. Gemini API use therefore cannot be described as conforming to the sovereign profile.

- `sovereign`: internal model/embedding endpoints only; public egress denied at the network layer.
- `gemini_external`: explicit reviewed egress exception limited to the Google Generative Language API, with server-side secret custody, TLS, allowlisted destination, DLP/data-classification admission, rate limits, and audit evidence.

Protected or restricted policy content must not enter `gemini_external` until Governance approves that disclosure and the organization's Google data-processing terms and regional controls are recorded. There is no silent cloud fallback between profiles.

## Data, scaling, resilience, and deployment

- Metadata and owner state: relational store, leader plus replicas; shard by internal business unit only after vertical scaling, read replicas, and caching are exhausted.
- Source versions: encrypted digest-addressed object storage with at least three failure-domain copies.
- Retrieval: independently replicated lexical/vector indexes; immutable generation pointer prevents partial publication.
- Cache: bounded cache-aside candidate-reference cache with generation-addressed keys and event-driven invalidation.
- Ingestion: durable at-least-once queue, idempotent stages, transactional outbox, dead-letter/quarantine path, and queue-age autoscaling.
- Serving: at least two stateless replicas per failure domain, L7 load balancing, readiness/liveness checks, separate concurrency and byte bulkheads.
- Deployment: canary at 1-5%, then 10%, 50%, and 100% with automatic rollback on grounded-answer accuracy, p99 latency, error rate, authorization, or audit regressions.
- DR: authoritative owners define RPO/RTO; indexes and caches are rebuilt from immutable versions and publication manifests, not treated as authorities.

## Observability and acceptance

Track the four golden signals plus retrieval-stage latency, candidate counts, cache hit rate, no-context rate, authorization latency, citation validity, grounded-answer accuracy, Gemini latency/quota errors, ingestion lag, and index generation age. Logs and traces use opaque references and digests only.

Production acceptance requires:

- representative-corpus recall/precision and citation accuracy;
- adversarial prompt-injection and irrelevant-query abstention tests;
- authorization revision races at retrieval, generation, and citation boundaries;
- 100/500/1,000-candidate and 1,300-concurrency load campaigns;
- dependency/domain loss, cancellation storm, queue saturation, restore, and rollback tests;
- audited proof that no protected bytes are released without current authorization.

## System-design diagnostic

Current repository implementation score after the governed integration: **8/10** (6 of 8 diagnostic rows pass). Requirements, capacity formulas, bounded caching, synchronous authorization/audit admission, readiness, monitoring fields, and deployment strategy exist. The remaining failing rows require deployed infrastructure evidence:

1. Runtime redundancy/database scaling is not provable from a desktop repository: deploy at least three stateless replicas, replicated authority/audit stores, immutable object storage, and independently searchable index copies; then execute failure-domain tests.
2. The bundled demonstration corpus is static: production must publish through the durable asynchronous ingestion queue, transactional outbox, immutable generation controller, and restore campaign.

The target design is **10/10** when those two production evidence gates pass. Passing unit tests alone does not change this score.

## Runnable profiles

`local_policy` is the default development profile. When `RAG_CORPUS_ROOT` is absent it loads `server/sample-policy-corpus`, a clearly marked fictional Northstar Dynamics corpus. It must never be used as organizational policy or legal guidance.

`governed_policy` is the production serving profile. Startup fails unless an immutable corpus root, stable corpus reference, HTTPS authorization endpoint, HTTPS audit-admission endpoint, and workload authority token are configured. Authorization is evaluated once for the retrieval operation and again for the exact resource/version/chunk set. Audit admission must return a durable receipt before Gemini is called. `/ready` returns 503 for a missing or empty corpus generation, allowing the load balancer to remove the replica.

Production secrets are injected by the workload secret manager and never committed. The authority token should be replaced by short-lived workload identity/mTLS when the deployment authority supports it; the bearer-token adapter is a narrow transport seam, not a recommendation for long-lived shared credentials.
