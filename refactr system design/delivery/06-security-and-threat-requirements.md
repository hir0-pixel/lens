# Security Requirements And Threat Model

## 1. Security Objective

Prevent unauthorized disclosure, action, privilege, execution, persistence and external egress even when users, administrators, workloads, clients or dependencies behave maliciously and failures occur concurrently.

This document operationalizes the architecture; it does not claim invulnerability or certification.

## 2. Assets And Trust Boundaries

Protected assets include source documents, prompts, outputs, conversations, memory, embeddings, indexes, model artifacts/weights, KV cache, credentials, identity/policy/governance state, agent/tool data, audit evidence, backups and telemetry.

Trust boundaries exist at endpoint-to-edge, building-to-private-WAN, service-to-service, authority-to-enforcer, control-to-data plane, parser/sandbox-to-platform, GPU/node-to-workload, tool-to-target, build-to-runtime, backup-to-restore cell and administrator-to-management plane.

## 3. Threat Actors

- Employee using valid access for extraction, probing or unauthorized combinations
- Compromised/stolen managed endpoint or session
- Knowledge steward, operator, developer, security analyst or auditor abusing privilege
- Colluding privileged roles
- Malicious document, model, dependency, tool response or build artifact
- Compromised workload, node, control plane, BMC, network device or update media
- External attacker reaching an internal service through a compromised path
- Accidental misconfiguration, stale policy, retry storm, partial failure or recovery surge

## 4. Mandatory Controls

| Control family | Requirement |
|---|---|
| Zero trust | Authenticate every human/workload; authorize exact action/resource using current owner facts |
| Least privilege | Short-lived scoped identity/credentials; no standing production/admin access |
| Separation of duties | Self-affecting/toxic changes require independent approval and one-use fences |
| Data release | Buffer generated output; classify, reserve exposure, authorize exact digest, audit and persist before release |
| Isolation | Untrusted content/code in disposable microVMs with no network, credentials or host access |
| Platform | Measured boot, immutable nodes, admission control, default-deny network, control-plane/etcd isolation and no interactive root |
| Supply chain | Reviewed source, isolated reproducible build where practical, SBOM, signed provenance, digest admission and revocation |
| Cryptography | Versioned approved profile, purpose-separated keys, HSM-backed high-value keys and tested rotation/destruction |
| Endpoint | Managed posture, device-bound sessions, DLP controls and PAWs for administrators |
| Audit | Quorum admission for protected/privileged success, target-side outcome and witnessed immutable ledger |
| Detection/response | Pseudonymous insider analytics, protected case workflow, containment APIs and clean-room recovery |
| Physical | Restricted zones/racks, dual-person sensitive access, isolated BMC/OOB, media custody and sanitization |

## 5. Abuse Cases That Must Fail

1. A user infers denied document existence through response shape/timing or citations.
2. A revoked user continues a long generation or reads a prior output.
3. Concurrent sessions exceed aggregate exposure, quota or agent limits.
4. Prompt/document/tool text changes system instructions, authority facts or destinations.
5. A tool follows a redirect, webhook, federation or recipient expansion outside its approved sovereign target.
6. A parser/model artifact escapes isolation or obtains network/credentials.
7. An administrator self-grants, replays a change fence or uses direct database/node access.
8. A compromised build/registry/node runs unsigned or revoked code/model/configuration.
9. Cache/index/replica lag returns stale authorized content after withdrawal/revocation.
10. Retry, failover or ambiguous outcome duplicates a non-idempotent generation/tool action.
11. Logging, tracing, crash dumps, support bundles or backups expose protected payloads.
12. Public DNS/IP/proxy/update/license paths become an accidental egress route.

## 6. Secure Development Requirements

Threat model each material change; require security review for trust-boundary changes. Enforce branch protection, signed commits/releases as policy requires, dependency allow-lists, secret scanning, SAST, type/schema checks, IaC policy, container/model scanning, SBOM/provenance verification, fuzzing for parsers/protocols, and security unit/integration tests. Critical/high vulnerabilities block release unless the security authority records an expiring risk decision that does not waive a P0 invariant.

Production data is forbidden in developer/test environments. Synthetic adversarial corpora and sanitized fixtures are used. Break-glass is time-bound, independently approved, continuously observed and cannot bypass audit or data-release controls.

## 7. Verification Program

Before pilot and after material changes: independent architecture review; code review; API authorization testing; infrastructure and Kubernetes assessment; internal/external penetration test conducted inside the sovereign boundary; AI red-team for prompt injection, extraction, poisoning and agent abuse; insider simulations; supply-chain compromise exercises; parser/sandbox escape tests; zero-egress validation; physical/BMC review; and recovery/forensics drills.

Findings have severity, affected digest, owner, due date, exploit evidence, compensating controls and verified closure. Retesting is mandatory.

## 8. Security Release Gate

Production is blocked by any missing P0 control, unresolved critical/high finding, failed sovereignty probe, incomplete audit path, unauthorized byte release, unsigned/unattested runtime, expired critical evidence or untested material change. Security approval is necessary but does not replace Product, Governance, SRE or recovery approval.

## 9. Synthetic External-Provider Test Boundary

The development Gemini integration is a named exception, not an alternative
production trust boundary. It may process only a dataset classified `synthetic`
and explicitly opted into the test mode. The API key remains in the server-side
RAG service; the desktop/browser client receives no credential and makes no
provider request. The bridge is disabled by default, accepts only bounded
requests from the local BFF, returns generic dependency errors, and records no
prompt, retrieved context, answer, or credential in routine telemetry. Any
non-synthetic corpus, production environment, missing guard, or attempted
fallback fails closed.
