# Product Requirements Document
## Sovereign Enterprise AI Platform

| | |
|---|---|
| Status | Implementation baseline |
| Product stage | Phase 1 foundation and controlled pilot |
| Architecture scope | Documents 001-025 |

## 1. Product Objective

Provide an organization-specific AI layer for chat, governed knowledge retrieval and approved agent/tool workflows while keeping all protected data, metadata, prompts, outputs, sessions, model state and operational evidence inside company-controlled infrastructure.

## 2. Users And Roles

| Role | Primary needs | Constraints |
|---|---|---|
| Employee | Ask questions, use approved knowledge and revisit authorized conversations | Only current entitlements; managed device for protected modes |
| Knowledge steward | Ingest, classify, publish, withdraw and review documents | Cannot grant themselves access or bypass approval |
| Tool approver | Approve bounded high-risk actions | Approval binds exact actor, arguments, target, risk and expiry |
| Security/governance operator | Manage policy, investigate alerts and contain incidents | JIT privilege, separation of duties and complete audit |
| Platform/model operator | Deploy services and eligible models | No standing production access or direct data browsing |
| Auditor | Verify immutable evidence and control operation | Read-only, purpose-bound and independently authorized |

## 3. In-Scope Capabilities

### 3.1 Identity And Access

- Synchronize workforce identities and current group/clearance facts from authoritative company systems.
- Authenticate users with phishing-resistant credentials; bind protected sessions to managed endpoint posture.
- Evaluate authorization live for every protected query, context use, tool boundary and output disclosure.
- Revoke access promptly and fail closed when an authority is unavailable or uncertain.

### 3.2 Enterprise Chat

- Create, list, rename, archive and delete conversations subject to retention policy.
- Submit an idempotent turn, observe explicit state, cancel work and retrieve a finalized result.
- Preserve prompts and outputs durably according to classification and retention.
- Never expose partial protected model output before final governance, authorization, audit and persistence gates complete.
- Reauthorize every later read of conversation content.

### 3.3 Governed Knowledge

- Ingest supported documents through isolated parsing, malware/content validation, versioning and publication.
- Preserve source identity, provenance, classification, ACL and lifecycle state.
- Search through bounded lexical/vector/graph lanes and return only content allowed by a current batch decision.
- Withdraw, supersede or revoke content without stale cache/index paths continuing disclosure.
- Show citations that resolve to the exact authorized source version.

### 3.4 Models And Inference

- Register, evaluate, approve, route, serve, canary and revoke internal model artifacts without provider lock-in.
- Support bounded context/output sizes, cancellation, continuous batching and measured GPU admission.
- Isolate session/model memory and clear KV/GPU/host residue between incompatible security domains.
- Degrade explicitly when capacity is unavailable; never send work to an external model.

### 3.5 Agents And Tools

- Execute only registered tools with typed schemas, reviewed targets and transitive egress profiles.
- Enforce immutable per-run limits for steps, branches, tokens, time, side effects, risk and cost.
- Require exact, fresh authorization and human approval where policy demands it.
- Run untrusted code/content in disposable, credential-free, network-denied isolation.
- Reconcile ambiguous side-effect outcomes instead of blind retry.

### 3.6 Administration And Operations

- Manage approved models, documents, policies, quotas, integrations and releases through JIT privileged workflows.
- Produce immutable, witnessed audit evidence for all protected and privileged paths.
- Monitor SLOs, saturation, security signals and sovereignty probes without logging protected payloads by default.
- Back up, restore and fail over while preserving authorization, audit, confidentiality and recovery ordering.

## 4. Product Rules

1. Production protected workloads have zero external data egress and no fallback exception. A separately configured, synthetic-data-only development provider is permitted only under the controlled exception below.
2. Network location, document tags, cached decisions and model claims are never authorization authorities.
3. Each responsibility has exactly one authoritative owner as defined by Document 001.
4. Denied, missing, stale, malformed, overloaded or uncertain security state fails closed.
5. Queues, buffers, caches, pools and retries are bounded by item, byte, age and concurrency limits.
6. User-visible completion means durable finalization, current disclosure authorization, audit admission and exposure accounting have completed.
7. Production eligibility belongs to an exact deployment digest and expires or invalidates after material change.

## 5. Non-Functional Requirements

| Area | Requirement |
|---|---|
| Sovereignty | Continuous probes from every workload class must prove public network, DNS, proxy, update, support and tool-relay paths cannot carry protected data |
| Scale | Phase 1: 3,000-4,000 employees and ~650 generating requests with headroom. Phase 2: 10,000+ and ~1,300 without architecture replacement |
| Connections | At least 20,000 authenticated open connections and 2,000 active workflows at the Phase 2 evidence floor |
| Burst | At least 500 accepted new requests/s plus two-times measured generation-start burst for five minutes |
| Authorization | Initial 100-candidate full admission path objective p99 <= 250 ms at no less than 43 generation starts/s; 500/1,000 candidates have signed measured budgets |
| Availability | Initial interactive target 99.9%; eligible authorization and protected-release controls 99.99%; final values are signed after deployment measurement |
| Durability | No acknowledged protected turn, audit event, authority change or committed side effect may silently disappear |
| Failure | Critical service floor survives loss of the largest declared correlated failure domain |
| Recovery | RPO/RTO values are declared per data class and proved through witnessed restoration/failover drills |
| Compatibility | N/N-1 wire/state/schema/config compatibility and expand-migrate-contract database changes |
| Accessibility | Existing UI must meet WCAG 2.2 AA for supported workflows before general availability |

## 6. MVP And Phasing

### Phase 0 - Foundations

Identity, workload identity/secrets, audit admission, secure delivery, private network controls, API conventions, observability, data classification and evidence automation.

### Phase 1 - Controlled Employee Assistant

Enterprise chat, conversation persistence, document ingestion, governance, hybrid retrieval, one approved model family, GPU scheduling, citations, admin operations and restore/failover. No autonomous high-risk side effects.

### Phase 1.5 - Governed Tools

Read-only tools first, then explicitly approved reversible writes. Every tool must have typed contracts, target profiles, reconciliation and sandbox evidence.

### Phase 2 - Enterprise Scale And Advanced Agents

10,000+ employee envelope, 1,300 concurrent generation floor, multiple model profiles, bounded multi-step agents, multi-building capacity and full failure-domain evidence.

## 7. Out Of Scope

- Public SaaS or consumer tenancy
- External model/API fallback
- Open internet browsing from protected workloads
- Training on employee conversations by default
- Unreviewed plugins, arbitrary URLs or dynamic tool discovery
- Personal/unmanaged endpoints for protected workflows
- Claims of legal certification without an independent assessment

## 8. Product Acceptance

Phase 1 is accepted only when every P0/P1 requirement in `02-requirements-traceability.md` has passing evidence, no unresolved critical/high security finding exists, recovery drills pass, and Product, Security, Data Governance, SRE and the accountable business owner sign the release record.

The Phase 1 employee and administrator experience follows `10-ux-product-plan.md`. The current UI is retained as a compact visual shell, but developer-product assumptions that conflict with sovereignty or enterprise roles are not part of the accepted product.

## 9. Decisions Required Before Pilot

The accountable organization must approve: jurisdictions and compliance regimes; supported identity/document/integration systems; data-class taxonomy; retention/deletion schedules; initial model and languages; maximum context/output; tool allow-list; availability/RPO/RTO business targets; building topology; pilot population; accessibility/browser support; and incident/escalation ownership. These are deployment inputs, not permission to weaken the architecture.

## 10. Controlled External Model Development Exception

Gemini or another external model provider may be used only to exercise the
development RAG path with corpus material explicitly marked `synthetic`. The
provider API key is held by the server-side RAG service, never by the browser
or desktop client. The exception is explicit opt-in, disabled by default,
loopback-reachable only from the BFF, bounded by input/output/deadline limits,
and produces no prompt/context/output telemetry. It is prohibited in production
and cannot be a fallback for internal serving. Promotion requires an internal
or privately hosted model integration meeting the normal architecture gates.
