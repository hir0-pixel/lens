# Lens Production RAG Implementation Plan and OpenCode Execution Prompt

Use this entire file as the prompt for OpenCode. The work is not complete when the code compiles. It is complete only when the required security, contract, failure, deployment, and load gates pass and evidence is recorded.

## Role

Act as a principal distributed-systems, platform-security, and AI-infrastructure engineer. Productionize the Lens RAG request path in the existing repository without weakening the sovereign architecture.

Repository: `D:\Lens\lens`

Architecture source of truth: `D:\Lens\001-overall-system-architecture.md` through `D:\Lens\025-secrets-management.md`, especially Documents 003, 004, 005, 006, 007, 009, 011, 012, 013, 016, 020, 021, 022, 023, 024, and 025.

If those documents are unavailable, stop and request them. Do not infer or replace their contracts from this prompt alone.

## Current State

The repository currently contains:

- A React/Tauri client using the Lens BFF.
- A TypeScript BFF in `server/` with OIDC, CSRF protection, sealed cookies, and `/api/rag/ask`.
- A development-only Python bridge in `Enterprise-RAG/`.
- Reference implementations under `services/` for Gateway, Orchestrator, PDP, Governance, Retrieval, Memory, Model Gateway, Scheduler, and related authorities.
- A synthetic Qdrant corpus and a Gemini test generator.

The development bridge is not the production architecture. It currently:

- binds to loopback;
- forwards a subject header that the Python service ignores;
- searches chunks without live PDP candidate authorization;
- stores protected chunk text in index payloads;
- sends retrieved text to Gemini in synthetic test mode;
- uses per-process rate-limit and revocation state;
- has no executed production load evidence, although the repository now includes a bounded synthetic production-path harness that still requires real environment runs;
- has no production index-publication, rollback, or deletion contract.

Current production implementation score: **3/10** using the eight-part system-design diagnostic. Requirements and architecture-level capacity assumptions exist, but the implementation still fails the redundancy, datastore-scaling, cache/invalidation, asynchronous-work, observability, and production-deployment rows. The tracks below close those specific gaps; the score must be recalculated from executed evidence after implementation.

Preserve it only as an explicitly named synthetic example, or remove it after equivalent tests exist. It must never be reachable from a production build or deployment.

## Non-Negotiable Requirements

1. Zero data egress. Prompts, queries, chunks, embeddings, metadata, model inputs, outputs, sessions, identities, telemetry, and audit evidence must never leave company-controlled infrastructure.
2. The browser or desktop client never calls Retrieval, Qdrant, an inference runtime, or a model provider directly.
3. The only employee ingress is the Lens API Gateway/BFF through company-controlled private connectivity. Multi-building access uses private WAN, VPN, SD-WAN, or approved zero-trust access, not public exposure of Retrieval.
4. Authentication does not authorize document access. PDP performs live operation authorization before candidate expansion and live candidate authorization against current Governance facts before protected text is fetched.
5. The index may return immutable candidate references and non-authoritative search hints. It must not be the authorization authority.
6. Protected text is fetched from the sovereign content store only after allow decisions for the exact immutable document version and chunk.
7. Retrieval does not generate answers. It returns an authorized, versioned context package to the Orchestrator. Only the Orchestrator composes prompts, and only the internal Model Gateway dispatches inference.
8. No service silently falls back to Gemini, OpenAI, another cloud model, an external embedding endpoint, or an external search service.
9. Every synchronous stage has an absolute deadline, cancellation propagation, bounded memory, bounded concurrency, and a typed overload response. Do not hide overload in an unbounded queue.
10. Generation is not automatically retried. Idempotency is used only where the owning contract supports it, such as ingestion jobs and durable state transitions.
11. Logs, traces, metrics, and audit events never contain raw prompts, query text, document text, model output, cookies, tokens, credentials, or unrestricted user identifiers.
12. Production secrets are issued by the approved secrets/workload-identity system. No `.env`, key, password, bearer token, backup database, or model credential may be committed.
13. A single 8 GB GPU is a demo target, not evidence for organization-wide inference capacity. Retrieval and connection scale must remain separated from GPU generation admission.
14. Do not claim production readiness from unit tests alone. Record deployment-specific evidence for hardware, corpus, model, latency, concurrency, failure, restore, and security gates.

## Required Target Flow

```text
Employee client
  -> private company access path
  -> Lens API Gateway / product BFF
  -> AI Orchestrator
  -> Retrieval operation PDP decision
  -> bounded hybrid candidate search
  -> batch candidate PDP decision using current Governance revisions
  -> immutable protected chunk fetch after allow
  -> exact context and authorization manifest
  -> generation-start fence revalidation
  -> internal Model Gateway
  -> Scheduler reservation
  -> on-prem Inference Pool
  -> output guards, Governance disclosure reservation, audit admission
  -> durable turn commit
  -> client response or stream
```

The BFF must not call the production Retrieval Service directly. Keep `/api/rag/ask` as a compatibility endpoint if required by the current UI, but internally route it through the Orchestrator. Prefer the stable turn API from Document 024 when it is already represented in the repository.

## Internal Contract Requirements

Define versioned schemas in `contracts/` and generate or validate both TypeScript and Python representations. Reject unknown or oversized fields at trust boundaries.

### BFF to Orchestrator request

Carry at least:

- server-generated `request_id`;
- durable `turn_id` when the turn contract requires it;
- trusted `subject_ref`, `session_ref`, `device_ref`, and application identity;
- purpose and retrieval class;
- normalized user query reference or protected body;
- server-capped absolute deadline;
- cancellation and one-attempt retry-budget metadata;
- route/bulkhead identity;
- model capability request, never a provider-specific model name from the client.

Do not accept a client-supplied `subject_ref`, role, clearance, policy decision, model endpoint, index generation, or authorization manifest.

### Orchestrator to Retrieval request

Use a versioned internal request containing:

- request and turn identity;
- trusted subject/session/device/application context;
- query and approved filters;
- corpus and retrieval class;
- absolute deadline and cancellation;
- active bulkhead identity;
- required publication and policy consistency minimums where defined by the architecture.

Authenticate the Orchestrator using workload identity and mTLS. A shared token alone is insufficient.

### Retrieval response

Return one of the stable typed states defined in Document 006. All zero-authorized-context cases must be externally indistinguishable as `no_context`.

For authorized context, include:

- `retrieval_id` and request identity;
- active `visibility_sequence` and index generation;
- immutable document-version and chunk references;
- content digests;
- resource-security revisions and their aggregate digest;
- classification and lineage references required by Governance;
- PDP decision/fence references, policy revision, subject-security revision, expiry, and context digest;
- only the protected text belonging to allowed exact chunk versions;
- a digest over the complete ordered context package.

Do not return denied candidate identities, candidate counts, authorization reasons, raw ACLs, or existence-revealing errors to the client.

## Implementation Tracks

Complete the tracks in dependency order. Do not stop after scaffolding.

### Track 0: Repository and security hygiene

- Inspect the current branch, worktree, generated files, and existing tests before editing.
- Remove `server/.env` from Git tracking while preserving `server/.env.example`. Confirm that no real secret has entered history; if one has, report it and require rotation.
- Inspect tracked backup databases and synthetic documents. Keep only explicitly synthetic fixtures with documented classification.
- Add a production build check that rejects Gemini, external model/search URLs, test IdP mode, loopback demo adapters, and missing workload identity.
- Add a network-egress policy and an automated test proving production workloads cannot resolve or connect to public destinations.
- Pin Python dependencies with hashes or the repository's approved reproducible lock mechanism. Prevent runtime model downloads and remote code execution from model packages.

Acceptance:

- secret scanning passes;
- production configuration fails closed;
- external endpoints are absent from the production artifact and deployment manifests;
- the Git worktree contains no tracked runtime secrets.

### Track 1: Stable contracts and ownership boundaries

- Create or update the request, result, error, deadline, cancellation, authorization-manifest, citation-lineage, and overload contracts in `contracts/`.
- Reuse the existing reference authorities in `services/` rather than duplicating PDP, Governance, Orchestrator, Model Gateway, Memory, or Audit ownership inside the BFF or Python service.
- Replace production use of `server/src/rag/localRagClient.ts` with an Orchestrator client. The frontend endpoint may remain stable.
- Keep provider-specific details behind the Model Gateway contract.
- Add compatibility tests for version N and N-1 during rolling deployment.

Acceptance:

- the BFF cannot construct an authorization decision;
- Retrieval cannot invoke an inference provider;
- the client cannot choose an internal endpoint or trusted identity field;
- generated schemas and implementations agree.

### Track 2: Production Retrieval Service

Build a separately deployable, stateless Retrieval API. Python may be retained for local embedding and reranking libraries, but replace `ThreadingHTTPServer` with a production server and explicit resource controls.

Required behavior:

- mTLS/workload-identity authentication and an Orchestrator-only ingress policy;
- strict payload and header limits;
- operation PDP authorization before candidate search;
- bounded dense and sparse search with deterministic fusion;
- candidate caps compatible with 100, 500, and 1,000 candidate authorization batches;
- batch PDP authorization using current Governance facts from one committed snapshot;
- protected chunk fetch only after allow;
- reranking only over allowed content;
- exact lineage and authorization manifest construction;
- quorum audit admission before protected context leaves Retrieval;
- absolute deadline propagation to index, Governance, PDP, content, and Audit clients;
- cancellation that stops outstanding work;
- fixed worker, request, candidate-byte, connection, and memory limits;
- immediate typed `429` or `503` when capacity is exhausted;
- separate readiness and liveness probes;
- graceful drain during deployment.

Do not rely on `async` syntax to make CPU-bound embedding or reranking scalable. Use a measured fixed process/worker profile or dedicated internal embedding/reranking serving pool. Each replica must have a known maximum active-request count and memory envelope.

### Track 3: Index and protected content separation

- Remove raw protected chunk text from vector/sparse index payloads.
- Store only immutable candidate references, embedding/index metadata, and permitted search hints in indexes.
- Store immutable chunk content in the sovereign document content store.
- Pin embedding model digest, tokenizer digest, vector dimensions, distance metric, chunking profile, and schema version per index generation.
- Introduce an independent publication record with one authoritative writer, monotonic `visibility_sequence`, active generation, searchable-copy set, integrity digest, activation time, and rollback state.
- Build a new inactive generation, validate it, then atomically publish it through the independent manifest. Never mutate the active generation in place.
- Implement deletion, withdrawal, ACL/classification change, failed-integrity, refeed, and rollback behavior. Removed documents must not remain retrievable because stale points were never deleted.
- Use the currently selected on-prem index technology only after confirming it meets the contract. A Qdrant adapter is acceptable if it is clustered, replicated, benchmarked, and subordinate to the independent publication manifest.

Acceptance:

- no index query returns protected text;
- publication cutover never mixes generations in one request;
- rollback and deletion tests pass under concurrent queries;
- a stale index hint cannot grant access.

### Track 4: Ingestion and re-indexing

- Convert ingestion into durable, bounded asynchronous jobs using the event backbone already selected by the architecture. Do not introduce a queue product solely because it is fashionable.
- Make jobs idempotent using source/version/profile identity.
- Separate parsing, malware/content validation, classification reservation, chunking, embedding, indexing, verification, and publication.
- Use owner DB plus transactional outbox for authoritative state and event publication.
- Add dead-letter/quarantine handling with bounded item, byte, age, and disk limits.
- Support restart, replay, deduplication, poison-document quarantine, backpressure, and recovery-surge throttling.
- Never publish a partially processed or unverifiable generation.

### Track 5: Orchestrator and internal model serving

- Wire the production request through the existing Orchestrator contracts.
- Retrieval returns context; Orchestrator owns prompt composition.
- Revalidate the unexpired generation-context fence and exact context digest at generation start and every tool-call boundary.
- Dispatch only through the Model Gateway using a capability request.
- Require Scheduler admission before GPU allocation.
- Use only internal model endpoints. Remove direct Gemini/Ollama/provider calls from the production RAG path.
- Preserve cancellation through Model Gateway and inference runtime.
- Do not automatically retry non-idempotent generation.
- Commit output durability and terminal turn state in the order required by Documents 004 and 008.
- Apply output guards, derived classification, disclosure reservation, audit admission, and durable result authorization before release.

### Track 6: Horizontally scalable BFF and gateway state

- Replace the per-process fixed-window `Map` limiter with the architecture's atomic distributed token-bucket or behaviorally equivalent GCRA store.
- Rate-limit by trusted subject, application, route, device/risk class where approved, and source network as a secondary signal. Do not rely solely on spoofable client IP headers.
- Give every limit a documented burst, refill, scope, TTL, and `Retry-After` behavior.
- Replace per-process logout/revocation state with the Session Authority/shared strong state required by Documents 002 and 003.
- Make OIDC pending-flow state safe across replicas or provide cryptographically bound stateless state where the accepted contract permits it.
- Bound request-body bytes, accepted sockets, downstream in-flight requests, output buffers, stream age, and idle time.
- Add per-route serving bulkheads so retrieval traffic cannot starve authentication, revocation, cancellation, health, or administrative controls.
- Keep the BFF stateless enough to add/remove replicas without changing behavior.

### Track 7: Multi-building deployment

- Provide production deployment manifests using the repository's established on-prem deployment method.
- Place redundant L7 Gateway/BFF replicas behind private company DNS and managed TLS.
- Employees in other buildings connect through approved private WAN/VPN/SD-WAN/zero-trust access.
- Do not expose Retrieval, PDP, Governance, Qdrant, content storage, Audit, Model Gateway, Scheduler, or inference nodes to user networks or the public internet.
- Enforce east-west mTLS, workload identity, namespace/network policy, least privilege, and explicit egress deny.
- Run at least two stateless replicas per serving service and spread them across declared failure domains.
- Configure disruption budgets, anti-affinity, graceful drain, canary rollout, and rollback.
- Scale Retrieval on active requests, p95/p99 latency, saturation, and bounded worker utilization. Scale ingestion workers on bounded queue depth and oldest age. Never scale solely on average CPU.
- Implement backup, restore, and campus-failover procedures consistent with Document 022.

Do not place prompts, outputs, document chunks, embeddings, vector indexes, secrets, or conversation history in building-edge caches unless an explicit later ADR authorizes that exact data class.

### Track 8: Observability and audit

- Add RED metrics for every request-driven service and USE metrics for CPU, memory, disk, connections, index clients, worker pools, and model-serving resources.
- Include request, turn, retrieval, decision, index-generation, and trace references using governed/HMAC forms where required.
- Add histograms for total and stage latency, candidate counts, authorized counts in restricted telemetry, active requests, overloads, cancellations, dependency failures, and audit-admission failures.
- Add distributed traces without content.
- Add alerts for authorization failure spikes, all-denied/no-context anomalies, stale publication manifests, queue saturation, Qdrant replica loss, PDP/Governance latency, audit quorum loss, and recovery stampedes.
- Provide dashboards and runbooks. Logs are operational telemetry, not the authoritative audit ledger.

## Failure Semantics

Implement and test these cases explicitly:

| Failure | Required behavior |
|---|---|
| Missing/invalid session | Reject before Orchestrator work |
| Missing workload identity | Reject before Retrieval work |
| PDP or Governance unavailable | Fail closed; return no protected text |
| Candidate batch exceeds envelope | Reject or reduce search before protected fetch; never split into inconsistent snapshots |
| Index copy unavailable | Use only an approved copy in the pinned active generation; otherwise fail typed |
| Content digest mismatch | Quarantine chunk/generation and return no context from it |
| Audit quorum unavailable | Return no protected context/output |
| Retrieval saturated | Immediate bounded `429`/`503`; no hidden queue |
| Client disconnect/deadline | Cancel downstream retrieval and generation promptly |
| Model capacity unavailable | Typed capacity response; no external fallback |
| ACL revoked during request | Current revision/fence checks fail closed at the defined boundaries |
| Deployment during traffic | N/N-1 compatibility; drain old replicas; no mixed index generation |
| Dependency recovery after outage | Bounded jittered recovery; no retry or cache-miss herd |

## Testing and Evidence Gates

Add automated tests at all relevant layers.

### Security and authorization

- operation allow/deny;
- candidate allow, deny, mixed, all-denied, and no-match;
- no observable distinction between no-match and all-denied responses;
- group/ACL/classification/publication/integrity changes during retrieval;
- stale decision, expired fence, context-digest mismatch, replayed fence, and revoked session;
- direct calls to Retrieval, Qdrant, content storage, or model runtime from an untrusted client;
- prompt injection in retrieved documents;
- SSRF, oversized input, malformed JSON, header spoofing, CSRF, CORS, and log-redaction checks;
- zero-egress test with public DNS and network destinations blocked and monitored.

### Correctness

- deterministic fusion and reranking fixtures;
- exact citation-to-chunk/version mapping;
- no citations for chunks absent from the authorized context package;
- generation uses exactly the digest covered by the generation fence;
- ingestion replay/deduplication and deletion;
- publication activation, rollback, partial-copy failure, and refeed races.

### Reliability

- PDP, Governance, Audit, Qdrant, content-store, Orchestrator, Model Gateway, and inference partial failures;
- timeout and cancellation at every stage;
- one replica and one declared failure-domain loss;
- rolling deployment with N/N-1 clients and schemas;
- backup restore and failover with audit-ledger completeness verification.

### Load

Use representative corpus sizes and p50/p95/p99 query/context distributions. At minimum, test:

- 100, 500, and 1,000 candidates per request;
- at least 43 generation starts per second and a 2x retrieval stress profile unless a later accepted capacity profile supersedes it;
- 100, 500, and 1,000 concurrent connected sessions without equating every connection to active GPU work;
- sustained load for at least 30 minutes plus burst, saturation, cancellation, dependency-loss, and recovery-surge phases;
- the largest declared serving-domain failure during load;
- bounded memory, bounded queues, no thread explosion, no unauthorized disclosure, and no OOM.

Do not invent an SLO after seeing results. Derive stage budgets from the architecture's end-to-end deadline and record p50, p95, p99, error rate, overload rate, saturation, and capacity headroom. Production remains NO-GO when evidence is missing.

Repository note: `scripts/readiness/production-rag-load.mjs` is the bounded synthetic evidence harness for the internal Orchestrator `/v1/chat` and Retrieval `/v1/retrieve` paths. It is locally testable and content-free, but it does not satisfy any load/failure gate until executed in the target environment with operator-supplied immutable digests and recorded evidence.

## Required Deliverables

1. Production code and generated contracts.
2. Database schemas and migrations with rollback compatibility.
3. On-prem deployment manifests, network policies, secrets references, probes, disruption budgets, scaling configuration, and resource limits.
4. Unit, contract, integration, security, chaos, and load tests.
5. `docs/production-rag-runbook.md` covering deployment, rollback, key rotation, index publication/rollback, overload, dependency outage, backup/restore, and campus failover.
6. `docs/production-rag-threat-model.md` with assets, trust boundaries, abuse cases, mitigations, and residual risks.
7. `docs/production-rag-evidence.md` containing commands, environment profile, corpus/model/index digests, test results, benchmark data, and unresolved gates.
8. An ADR for every necessary deviation from Documents 001-025. Do not edit architecture documents merely to make the implementation easier.
9. A final traceability matrix mapping every non-negotiable requirement and acceptance gate to implementation files and tests.

## Work Division for Two Engineers

Engineer A owns:

- contracts and compatibility;
- BFF/Gateway shared admission and sessions;
- Orchestrator wiring;
- PDP/Governance/Audit/Model-Gateway clients;
- output release and durable turn behavior;
- external API and streaming behavior.

Engineer B owns:

- production Retrieval service;
- bounded embedding/reranking execution;
- index/content separation;
- ingestion, publication, deletion, and rollback;
- Qdrant/index deployment and failure behavior;
- retrieval load and corpus correctness tests.

Merge order:

1. Freeze generated contracts and test fixtures.
2. Implement both tracks behind interfaces and fakes.
3. Run cross-service contract tests.
4. Integrate the complete request path.
5. Run security and authorization races.
6. Run load, failure, rollout, and restore gates.

Neither engineer may bypass an unfinished dependency with an allow-all production mock. Test fakes must be impossible to activate in production configuration.

## Execution Rules for OpenCode

1. Start by reading `AGENTS.md`, the 25 architecture documents, repository status, package scripts, existing contracts, and the relevant code paths. Use the codebase-memory MCP graph first for structural discovery when available.
2. Produce a short implementation checklist tied to the tracks above, then implement it. Do not stop after proposing code.
3. Preserve unrelated user changes. Never reset or overwrite work that you did not create.
4. Prefer existing repository patterns and libraries. Add a dependency only when it solves a demonstrated requirement and can run fully on-premises.
5. Do not use cloud services for tests with protected data. Synthetic fixtures only.
6. Run focused tests after each track and the full applicable suite at the end.
7. Do not weaken or delete a failing security test to make the build green.
8. Do not claim a load, HA, DR, or security gate passed unless the command actually ran and its evidence is saved.
9. If hardware, certificates, identity endpoints, cluster infrastructure, or another external prerequisite is unavailable, complete all testable work and mark the exact gate `BLOCKED`, including the command and environment needed to finish it.
10. Do not commit or push unless explicitly instructed.

## Final Response Required from OpenCode

Return:

- changed files grouped by implementation track;
- the final end-to-end request path;
- security boundaries and authorization timing;
- commands run and exact pass/fail counts;
- benchmark environment and results;
- remaining blocked production evidence;
- architecture deviations and ADRs;
- a clear verdict: `IMPLEMENTATION READY` or `NOT READY`;
- a separate production verdict: `PRODUCTION GO` or `PRODUCTION NO-GO`.

Do not describe the system as production-ready if any required authorization, zero-egress, bounded-overload, durability, rollout, restore, or capacity gate is missing.
