# Production RAG Threat Model

## Security objectives

The platform must keep protected data on company-controlled infrastructure, evaluate authorization live at every protected query/action boundary, isolate tenants/owners/workloads, preserve authoritative Audit evidence, and remain bounded under malicious or accidental load. Observability must help operators without becoming a second content store.

## Assets

| Asset | Required protection |
| --- | --- |
| Prompts, outputs, chat/session history, memory, chunks, embeddings, indexes | Confidentiality, owner-scoped integrity, retention/deletion enforcement, zero egress. |
| Identity, subject attributes, authorization decisions and policy epochs | Authenticity, freshness, anti-replay, least privilege. |
| Model weights, adapters, system prompts and tool policies | Integrity, provenance, controlled disclosure. |
| HSM keys, workload credentials, mTLS keys and correlation HMAC keys | Non-exportability where required, purpose separation, rotation, revocation. |
| Audit ledger and witnessed checkpoints | Completeness, ordering, tamper evidence, recoverability. |
| Publication manifests and index visibility sequence | Single-writer integrity, atomic activation/rollback, delete/refeed correctness. |
| Capacity controls, queues, caches and telemetry | Availability, bounded resource use, content-free operation. |
| Deployment artifacts and recovery manifests | Provenance, admission, rollback compatibility, anti-downgrade. |

## Trust boundaries

1. Employee device/browser to private ingress and Identity Gateway.
2. Ingress/BFF to Orchestrator under workload identity and mTLS.
3. Orchestrator to live PDP/Governance/Audit authorities.
4. Orchestrator to Retrieval, Memory, Model Serving, and Tool Execution.
5. Ingestion to source systems, content storage, processing workers, and index-state writer.
6. Runtime workloads to Secrets/HSM and secure-time services.
7. Services to the telemetry collector/exporter and operator dashboards.
8. Production campus to backup media, restore cell, and recovery campus.
9. Human operators to privileged control planes through JIT, dual-control access.

No trust boundary permits public internet fallback. Network location alone is not identity or authorization.

## Adversaries and assumptions

Threat actors include an ordinary employee, a privileged but unauthorized insider, a compromised endpoint, a compromised workload replica, a malicious integration/source administrator, a supply-chain attacker, and an operator making an unsafe recovery action. Dependencies may partially fail, recover suddenly, return stale data, or partition. Multiple service replicas execute concurrently. These assumptions do not grant a compromised HSM root or simultaneous compromise of all independent approval authorities; those remain residual catastrophic risks requiring physical and organizational controls.

## Abuse cases and controls

| Abuse case | Boundary/asset | Required mitigation | Detection/evidence | Residual risk |
| --- | --- | --- | --- | --- |
| Employee prompts the model to reveal documents they cannot access | Query, retrieval, memory | Candidate retrieval is followed by live per-resource authorization; decision fences are revalidated at generation start and tool boundaries; no static ACL tag is authoritative | Authorization denials, all-denied/no-context anomaly, Audit decision receipt | Already emitted tokens cannot be revoked; minimize streaming window and audit revocation timing |
| User replays another session/request ID | Client/ingress | Server-bound session cookie, CSRF protection, workload-authenticated internal calls, owner checks; raw IDs never confer authority | Session anomaly and authorization failure signals | Compromised authenticated endpoint can act within the victim's active privileges |
| Insider queries telemetry for sensitive text or identities | Telemetry | Fixed-schema metrics, governed HMAC references, content-free traces, reject prompt/output/chunk/raw subject/session/token/secret attributes, restrict telemetry access | Forbidden-attribute/drop accounting and access audit | Low-cardinality operational metadata can still reveal workload timing; restrict retention and viewers |
| Operator or service uses raw IDs as metric labels | Telemetry | Metric API has no reference labels; collector rejects reference attributes on metric records; per-label and total series caps | Cardinality rejection and code tests | A separate ungoverned exporter could bypass this library; deployment admission must inventory exporters |
| Compromised workload sends arbitrary OTLP directly to the collector | Telemetry collector | Collector-side filter drops payload-named telemetry and span events; transform processor rewrites log bodies and keeps only approved metric/log/trace attributes before batch/export | Manifest acceptance check, collector drop/export metrics, dashboard/alert rules | OTTL misconfiguration or unsupported collector version can weaken sanitization; production must render/validate the exact collector image and config |
| Attacker causes label/cardinality explosion | Telemetry/exporter | Fixed metric names/label keys, bounded token lengths, per-label value cap, total series cap, bounded queue | Cardinality/drop counters, queue high-water marks | Dropped telemetry reduces visibility during attack; alerts must use out-of-band collector health too |
| Exporter outage causes service memory exhaustion | Service/exporter | Record/byte-bounded queue, single in-flight export, bounded batches, retain-on-failure within fixed queue, explicit failure/backpressure/drop accounting | Exporter failure/backpressure, queue saturation | Telemetry loss is accepted after bounds; Audit must remain independent |
| Retry storm after PDP/index/model recovery | Service dependencies | Bounded admission, jittered/capped retries in service contracts, cancellation, gradual queue drain, recovery-stampede signal | Dependency latency, active requests, saturation and recovery-stampede alerts | Mis-sized limits can still cause prolonged shedding; validate with load/chaos tests |
| Compromised service bypasses PDP or reuses stale decisions | Orchestrator/PDP | Workload identity, signed/fenced decisions, live authorization owner, revalidation at protected boundaries, fail closed on unverifiable context | Audit receipts, decision epoch mismatch, authorization anomalies | Fully compromised authorized orchestrator can misuse its granted path until revocation; isolate and rotate rapidly |
| Search/index returns unauthorized, deleted, or stale-generation content | Retrieval/index | Pinned generation/visibility/source revision sent to search, search echo mismatch fails closed, authorization after candidate generation, single index-state writer, searchable-copy quorum, deletion/refeed reconciliation | Publication staleness and no-context/denial anomalies, Audit records | Search engine defects may over-return candidates; post-filter authorization and content-hash verification remain mandatory |
| Publication split brain or rollback resurrects deleted data | Index state | Fenced single writer, monotonic visibility sequence, explicit rollback contract that reapplies deletes/refeeds | Manifest mismatch/staleness alerts | Control-plane compromise can publish a malicious signed state; require dual control and provenance |
| Prompt injection triggers unsafe tool action | Model/tool boundary | Model output is untrusted; tool broker owns authorization, typed schemas, allowlists, sandboxing, egress deny, quotas, idempotency where valid | Tool decision/audit receipts and anomaly signals | Authorized destructive tools retain business risk; require confirmation/approval policy |
| Model runtime or tool attempts internet egress | Sovereign boundary | Default-deny network policy, internal mirrors/resolvers, no cloud fallback, workload identity and explicit destinations | Network-policy/flow evidence and security alert | Misconfigured host networking or privileged pods can bypass policy; admission and node controls required |
| Malicious document poisons retrieval or exploits parser | Ingestion | Quarantine, content-type/size validation, sandboxed processing, provenance, malware scanning, owner-scoped publication | Ingestion failures, provenance/Audit evidence | Novel parser/model attacks remain possible; keep workers isolated and disposable |
| Secret appears in logs/traces through exception text | Service/telemetry | No arbitrary event payload API; fixed attributes; bounded safe-token validation; secrets never supplied to observability calls | Forbidden/rejected telemetry accounting and security tests | Upstream logging outside this abstraction remains a deployment audit risk |
| Correlation reference is brute-forced or linked across purposes | Telemetry/identity | HMAC-SHA256 with 256-bit secret, scope-separated input, rotating key ID, purpose-specific key, controlled lookup | Key epoch and access evidence | Low-entropy raw identifiers can be guessed by a holder of the HMAC key; tightly restrict key access |
| Correlation key rotation destroys incident continuity | HSM/telemetry | Key IDs in references, overlap window, old key verify/lookup-only, retention-aligned destruction | Rotation evidence and lookup tests | Long overlap increases compromise window; retention policy chooses tradeoff |
| Audit outage is hidden by operational logs | Audit/telemetry | Audit is a separate authority; protected Class A admission fails closed; docs prohibit substituting logs | Audit quorum/admission signal | Availability loss during Audit outage is intentional |
| Backup operator reads protected data | Backup/restore | Ciphertext-only movement, HSM envelope keys, separate-trust restore cell, dual control, no production/public route | Signed manifests, restore-cell and zeroization evidence | Collusion across independent controls remains residual |
| Failover creates two writable primaries | Campus recovery | Fence old generation before traffic movement, signed recovery manifest, target-side gate, current Audit/key/revocation epochs | Ledger completeness and authority-head reconciliation | Network partition can delay proof of fencing; remain closed when ambiguous |
| Supply-chain artifact introduces egress/backdoor | Build/deploy | Internal dependency mirrors, provenance, immutable digests, admission, no runtime internet dependency | Build/release evidence and runtime network controls | Trusted signer compromise requires key revocation and independent review |
| Privileged insider weakens limits or retention | Operations | JIT access, two-person approval, policy-as-code review, Audit admission, immutable evidence | Privileged-change Audit trail | Organizational collusion and physical access require separate corporate controls |

## Observability-specific security contract

- Metric names and labels are fixed and bounded. Request, turn, retrieval, decision, index-generation, trace, span, workload, subject, user, and session identifiers are never metric labels.
- Trace correlation uses `gref:v1:<key-id>:<scope>:<HMAC-SHA256>` references. Raw correlation sources and HMAC secrets are never stored by the observability abstraction.
- Trace attributes are allowlisted metadata only. There is no span-event API for payloads.
- Prompts, outputs, chunks, document/memory/tool payloads, raw subject/session/user identifiers, credentials, bearer values, and secrets are rejected before queue admission.
- The OTel Collector gateway repeats the boundary check: memory limiting first, payload-name filter second, fixed `keep_keys` allowlist and log-body rewrite third, then batch/export. Span events are dropped because arbitrary event payloads are not part of the approved telemetry contract.
- Queue records/bytes, exporter concurrency, batch size, series count, and values per label are bounded. Failures and drops are accounted without recursively generating telemetry.
- Operational telemetry cannot authorize, prove Audit completeness, or replace the authoritative Audit ledger.

## Required validation before production

The following remain mandatory external gates: adversarial mTLS/workload identity tests, network zero-egress tests, authorization race/revocation tests, hardware-backed key rotation, production exporter access/retention review, sustained load and recovery-stampede tests, encrypted backup restore, Audit ledger-completeness verification, and total-campus failover. Their absence is a production blocker, not evidence of safety.
