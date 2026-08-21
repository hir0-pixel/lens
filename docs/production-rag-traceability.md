# Production RAG Traceability Matrix

## Status definitions

- `VERIFIED LOCAL`: verified by the recorded local Track 8 test or root typecheck.
- `NOT RUN ENVIRONMENT`: implementation or test artifacts exist, but the required integrated, security, load, hardware, cluster, or recovery evidence was not run for this ledger.
- `NOT IMPLEMENTED`: no complete implementation or executable test artifact was identified in the current repository.

File presence is not proof that a gate passed. Except where explicitly marked `VERIFIED LOCAL`, the evidence remains open.

## Non-negotiable requirements

| ID | Requirement | Current implementation/tests | Status |
| --- | --- | --- | --- |
| NNR-01 | Zero data egress, including telemetry and Audit evidence | `platform/network/egress-policy.json`; `platform/network/sovereign-boundary.json`; `deploy/on-prem/rag/base/networking.yaml`; `deploy/on-prem/rag/base/observability.yaml`; `platform/observability/otlpExporter.ts`; `tests/security/egress/zeroEgressPolicy.test.ts`; `tests/unit/otlpExporter.test.ts` | VERIFIED LOCAL; NOT RUN ENVIRONMENT |
| NNR-02 | Client never calls Retrieval, Qdrant, inference runtime, or model provider directly | `services/product-bff/EmployeeBff.ts`; `services/orchestrator/Orchestrator.ts`; `tests/integration/m02-gateway-admission.test.ts`; `tests/integration/m06-rag-composition.test.ts` | NOT RUN ENVIRONMENT |
| NNR-03 | Only private Lens Gateway/BFF employee ingress | `deploy/on-prem/rag/base/runtime.yaml`; `deploy/on-prem/rag/base/networking.yaml`; `services/gateway/gatewayAdmission.ts`; `tests/security/deployment/ragManifests.test.ts` | NOT RUN ENVIRONMENT |
| NNR-04 | Authentication is not document authorization; PDP/Governance decisions are live | `services/pdp/PolicyDecisionPoint.ts`; `services/governance/GovernanceAuthority.ts`; `services/retrieval/RetrievalService.ts`; `tests/unit/m03Pdp.test.ts`; `tests/integration/m03-governance.test.ts`; `tests/unit/m06Retrieval.test.ts` | NOT RUN ENVIRONMENT |
| NNR-05 | Search index is not the authorization authority | `services/retrieval/HybridRetrievalService.ts`; `services/retrieval/RetrievalService.ts`; `contracts/rag/authorization-manifest.v1.schema.json`; `tests/unit/m06Retrieval.test.ts` | NOT RUN ENVIRONMENT |
| NNR-06 | Fetch exact protected text only after allow | `services/retrieval/SovereignContentStore.ts`; `services/retrieval/RetrievalService.ts`; `contracts/rag/retrieved-source.v1.schema.json`; `tests/unit/m06Retrieval.test.ts` | NOT RUN ENVIRONMENT |
| NNR-06A | Retrieval raw query is bounded, digest-bound, and never caller-routed | `contracts/rag/retrieval-request.v1.schema.json`; `retrieval-service/src/http.ts`; `retrieval-service/src/adapters.ts`; `retrieval-service/tests/http.test.ts`; `retrieval-service/tests/adapters.test.ts` | VERIFIED LOCAL |
| NNR-07 | Retrieval returns authorized context; Orchestrator composes; Model Gateway dispatches | `services/retrieval/RetrievalService.ts`; `services/orchestrator/RagComposition.ts`; `services/model-gateway/ModelGateway.ts`; `tests/integration/m06-rag-composition.test.ts`; `tests/integration/m07-serving.test.ts` | NOT RUN ENVIRONMENT |
| NNR-08 | No external model, embedding, or search fallback | `services/model-gateway/ModelGateway.ts`; `services/inference-adapter/OllamaInferenceAdapter.ts`; `platform/network/egress-policy.json`; `tests/security/production-config.test.ts` | NOT RUN ENVIRONMENT |
| NNR-09 | Deadlines, cancellation, bounded memory/concurrency, typed overload; no unbounded queue | `services/orchestrator/Orchestrator.ts`; `services/gpu-scheduler/GpuScheduler.ts`; `services/retrieval/ProductionRetrievalWiring.ts`; `platform/observability/telemetryCollector.ts`; `scripts/readiness/production-rag-load-lib.mjs`; `scripts/readiness/production-rag-load.mjs`; `tests/unit/m06Retrieval.test.ts`; `tests/unit/productionRagLoad.test.ts`; `tests/unit/productionObservability.test.ts` | VERIFIED LOCAL for harness behavior and bounded evidence contract; NOT RUN ENVIRONMENT for integrated load/failure execution |
| NNR-10 | Generation is not automatically retried; idempotency only under an owning contract | `services/orchestrator/Orchestrator.ts`; `services/ingestion/IngestionService.ts`; `tests/integration/m04-orchestrator.test.ts`; `tests/integration/m05-ingestion.test.ts` | NOT RUN ENVIRONMENT |
| NNR-11 | Logs, traces, metrics, and Audit never contain protected payloads, credentials, or unrestricted identifiers | `platform/observability/telemetryCollector.ts`; `platform/observability/productionObservability.ts`; `platform/observability/governedCorrelation.ts`; `platform/observability/otlpExporter.ts`; `tests/unit/productionObservability.test.ts`; `tests/unit/otlpExporter.test.ts`; `tests/unit/logger.test.ts` | VERIFIED LOCAL |
| NNR-11A | Operational telemetry has deployable internal-only OTel artifacts with collector-side sanitization, bounded queues, visible drops, HA-compatible alerting, file-managed dashboards, and explicit retention | `deploy/on-prem/rag/base/observability.yaml`; `platform/deployment/check-rag-manifests.mjs`; `tests/security/deployment/ragManifests.test.ts` | VERIFIED LOCAL for artifacts/static checks only; NOT RUN ENVIRONMENT for live emission, backend delivery, outage, retention purge, alert delivery, and HA |
| NNR-12 | Production secrets come from the approved secrets/workload-identity system | `platform/secrets/secrets-hsm-baseline.json`; `platform/identity/workload-identity.json`; `deploy/on-prem/rag/base/runtime.yaml`; `tests/security/m01-workload-trust.test.ts` | NOT RUN ENVIRONMENT |
| NNR-13 | Demo GPU is not organizational capacity evidence; retrieval/connection scale is separated from GPU admission | `services/gpu-scheduler/GpuScheduler.ts`; `platform/dr/deployment-capacity-profile.template.json`; `docs/production-rag-evidence.md` | NOT RUN ENVIRONMENT |
| NNR-14 | Production readiness requires deployment-specific hardware, corpus, model, latency, concurrency, failure, restore, and security evidence | `services/production-admission/ProductionAdmission.ts`; `tests/unit/m10ProductionAdmission.test.ts`; `docs/production-rag-evidence.md` | NOT RUN ENVIRONMENT |

## Required failure semantics

| Gate | Current implementation/tests | Status |
| --- | --- | --- |
| Missing/invalid session rejects before Orchestrator work | `services/gateway/gatewayAdmission.ts`; `tests/integration/m02-gateway-admission.test.ts`; `tests/unit/bffAuthClient.test.ts` | NOT RUN ENVIRONMENT |
| Missing workload identity rejects before Retrieval work | `services/retrieval/ProductionRetrievalWiring.ts`; `tests/security/m01-workload-trust.test.ts`; `tests/unit/m02Authorities.test.ts` | NOT RUN ENVIRONMENT |
| PDP or Governance unavailable fails closed and returns no protected text | `services/pdp/PolicyDecisionPoint.ts`; `services/governance/GovernanceAuthority.ts`; `services/retrieval/RetrievalService.ts`; `tests/unit/m06Retrieval.test.ts` | NOT RUN ENVIRONMENT |
| Candidate batch over envelope rejects/reduces before protected fetch without inconsistent snapshots | `services/retrieval/RetrievalService.ts`; `services/retrieval/HybridRetrievalService.ts`; `tests/unit/retrievalPipeline.test.ts` | NOT RUN ENVIRONMENT |
| Unavailable or stale index copy uses only an approved pinned-generation response or fails typed | `services/retrieval/PublicationAuthority.ts`; `services/retrieval/indexGenerationManifest.ts`; `services/retrieval/RetrievalService.ts`; `retrieval-service/src/adapters.ts`; `tests/unit/track3Publication.test.ts`; `tests/unit/retrievalPipeline.test.ts` | VERIFIED LOCAL; NOT RUN ENVIRONMENT |
| Content digest mismatch quarantines the chunk/generation and returns no context from it | `services/retrieval/SovereignContentStore.ts`; `services/retrieval/RetrievalService.ts`; `tests/unit/m06Retrieval.test.ts` | NOT RUN ENVIRONMENT |
| Audit quorum unavailable releases no protected context/output | `services/audit/AuditLedger.ts`; `services/gateway/auditProducer.ts`; `tests/unit/m10ProductionAdmission.test.ts` | NOT RUN ENVIRONMENT |
| Retrieval saturation returns immediate bounded 429/503 with no hidden queue | `services/retrieval/ProductionRetrievalWiring.ts`; `services/retrieval/RetrievalService.ts`; `tests/unit/retrievalPipeline.test.ts` | NOT RUN ENVIRONMENT |
| Client disconnect/deadline cancels retrieval and generation promptly | `services/orchestrator/Orchestrator.ts`; `services/gpu-scheduler/GpuScheduler.ts`; `tests/integration/m04-orchestrator.test.ts` | NOT RUN ENVIRONMENT |
| Model capacity unavailable returns typed capacity response with no external fallback | `services/model-gateway/ModelGateway.ts`; `services/gpu-scheduler/GpuScheduler.ts`; `tests/integration/m07-serving.test.ts` | NOT RUN ENVIRONMENT |
| ACL revoked during request fails at defined current-revision/fence boundaries | `services/pdp/PolicyDecisionPoint.ts`; `services/governance/GovernanceAuthority.ts`; `services/orchestrator/Orchestrator.ts`; `tests/unit/m03Pdp.test.ts`; `tests/integration/m04-orchestrator.test.ts` | NOT RUN ENVIRONMENT |
| Live deployment preserves N/N-1 compatibility, drains old replicas, and prevents mixed index generations | `contracts/compatibility/v1.json`; `deploy/on-prem/rag/base/runtime.yaml`; `services/retrieval/PublicationAuthority.ts`; `tests/security/deployment/ragManifests.test.ts` | NOT RUN ENVIRONMENT |
| Dependency recovery is bounded and does not produce retry/cache-miss herds | `services/orchestrator/Orchestrator.ts`; `services/retrieval/ProductionRetrievalWiring.ts`; `platform/observability/productionObservability.ts` | NOT RUN ENVIRONMENT |

## Security and authorization evidence gates

| Gate | Current implementation/tests | Status |
| --- | --- | --- |
| Operation allow/deny | `services/pdp/PolicyDecisionPoint.ts`; `tests/unit/m03Pdp.test.ts` | NOT RUN ENVIRONMENT |
| Candidate allow, deny, mixed, all-denied, and no-match | `services/retrieval/RetrievalService.ts`; `tests/unit/m06Retrieval.test.ts`; `tests/unit/retrievalPipeline.test.ts` | NOT RUN ENVIRONMENT |
| No externally observable distinction between no-match and all-denied | `contracts/rag/retrieval-result.v1.schema.json`; `services/retrieval/RetrievalService.ts`; `tests/unit/m06Retrieval.test.ts` | NOT RUN ENVIRONMENT |
| Group/ACL/classification/publication/integrity changes during retrieval | `services/governance/GovernanceAuthority.ts`; `services/retrieval/PublicationAuthority.ts`; `tests/integration/m03-governance.test.ts`; `tests/unit/track3Publication.test.ts` | NOT RUN ENVIRONMENT |
| Stale decision, expired fence, context-digest mismatch, replayed fence, revoked session | `services/pdp/PolicyDecisionPoint.ts`; `services/session/SessionAuthority.ts`; `services/orchestrator/Orchestrator.ts`; `tests/unit/m03Pdp.test.ts`; `tests/integration/m04-orchestrator.test.ts` | NOT RUN ENVIRONMENT |
| Reject direct untrusted calls to Retrieval, Qdrant, content storage, and model runtime | `deploy/on-prem/rag/base/networking.yaml`; `services/retrieval/ProductionRetrievalWiring.ts`; `tests/security/deployment/ragManifests.test.ts` | NOT RUN ENVIRONMENT |
| Prompt injection in retrieved documents | `services/tool-sandbox/UntrustedContentIntake.ts`; `services/agent-runtime/AgentRuntime.ts`; `tests/integration/m09-tool-execution.test.ts` | NOT RUN ENVIRONMENT |
| SSRF, oversized input, malformed JSON, header spoofing, CSRF, CORS, and log redaction | `services/gateway/gatewayAdmission.ts`; `services/product-bff/EmployeeBff.ts`; `tests/security/production-config.test.ts`; `tests/unit/logger.test.ts`; `tests/unit/productionObservability.test.ts` | NOT RUN ENVIRONMENT |
| Zero egress with public DNS/destinations blocked and monitored | `platform/network/egress-policy.json`; `deploy/on-prem/rag/base/networking.yaml`; `tests/security/egress/zeroEgressPolicy.test.ts` | NOT RUN ENVIRONMENT |
| Production mTLS/workload identity negative, rotation, and revocation behavior | `platform/identity/workload-identity.json`; `platform/secrets/secrets-hsm-baseline.json`; `tests/security/m01-workload-trust.test.ts` | NOT RUN ENVIRONMENT |

## Correctness evidence gates

| Gate | Current implementation/tests | Status |
| --- | --- | --- |
| Deterministic fusion and reranking fixtures | `services/retrieval/HybridRetrievalService.ts`; `tests/unit/retrievalPipeline.test.ts` | NOT RUN ENVIRONMENT |
| Exact citation-to-chunk/version mapping | `contracts/rag/retrieved-source.v1.schema.json`; `services/orchestrator/RagComposition.ts`; `tests/integration/m06-rag-composition.test.ts` | NOT RUN ENVIRONMENT |
| No citation for a chunk absent from the authorized context package | `services/orchestrator/RagComposition.ts`; `tests/integration/m06-rag-composition.test.ts` | NOT RUN ENVIRONMENT |
| Generation uses exactly the digest covered by the generation fence | `contracts/rag/authorization-manifest.v1.schema.json`; `services/orchestrator/Orchestrator.ts`; `tests/integration/m04-orchestrator.test.ts` | NOT RUN ENVIRONMENT |
| Ingestion replay/deduplication and deletion | `services/ingestion/IngestionService.ts`; `tests/integration/m05-ingestion.test.ts`; `tests/unit/track4IngestionDurability.test.ts` | NOT RUN ENVIRONMENT |
| Publication activation, rollback, partial-copy failure, and refeed races | `services/retrieval/PublicationAuthority.ts`; `services/retrieval/indexGenerationManifest.ts`; `platform/operators/indexPublicationClient.mjs`; `scripts/operators/index-publication.mjs`; `tests/unit/track3Publication.test.ts`; `tests/unit/indexPublicationCli.test.ts` | VERIFIED LOCAL; NOT RUN ENVIRONMENT |

## Reliability evidence gates

| Gate | Current implementation/tests | Status |
| --- | --- | --- |
| PDP, Governance, Audit, index, content-store, Orchestrator, Model Gateway, and inference partial failures | Relevant files under `services/`; `tests/integration/m03-governance.test.ts`; `tests/integration/m04-orchestrator.test.ts`; `tests/unit/m06Retrieval.test.ts`; `tests/integration/m07-serving.test.ts` | NOT RUN ENVIRONMENT |
| Timeout and cancellation at every stage | `services/orchestrator/Orchestrator.ts`; `services/retrieval/RetrievalService.ts`; `services/gpu-scheduler/GpuScheduler.ts`; integration tests under `tests/integration/` | NOT RUN ENVIRONMENT |
| One replica and one declared failure-domain loss | `deploy/on-prem/rag/base/runtime.yaml`; `deploy/on-prem/rag/base/autoscaling.yaml`; `platform/dr/deployment-capacity-profile.template.json` | NOT RUN ENVIRONMENT |
| Rolling deployment with N/N-1 clients and schemas | `contracts/compatibility/v1.json`; `deploy/on-prem/rag/overlays/canary/kustomization.yaml`; `docs/production-rag-runbook.md` | NOT RUN ENVIRONMENT |
| Backup restore and failover with Audit-ledger completeness verification | `deploy/on-prem/rag/base/dr.yaml`; `platform/dr/RecoveryCoordinator.ts`; `platform/dr/recovery-runbook.md`; `tests/unit/m10RecoveryCoordinator.test.ts` | NOT RUN ENVIRONMENT |

## Load and capacity evidence gates

| Gate | Current implementation/tests | Status |
| --- | --- | --- |
| Representative corpus and p50/p95/p99 query/context distributions | `platform/dr/deployment-capacity-profile.template.json`; `docs/production-rag-evidence.md` | NOT RUN ENVIRONMENT |
| 100, 500, and 1,000 candidates per request | `services/retrieval/RetrievalService.ts`; no executed production-scale evidence recorded | NOT RUN ENVIRONMENT |
| At least 43 generation starts/s and 2x retrieval stress, unless superseded by an accepted profile | `services/gpu-scheduler/GpuScheduler.ts`; `platform/dr/deployment-capacity-profile.template.json` | NOT RUN ENVIRONMENT |
| 100, 500, and 1,000 connected sessions without equating connections to GPU work | `services/session/SessionAuthority.ts`; `services/gpu-scheduler/GpuScheduler.ts` | NOT RUN ENVIRONMENT |
| Sustained 30-minute load plus burst, saturation, cancellation, dependency loss, and recovery surge | `platform/observability/productionObservability.ts`; no executed load harness evidence recorded | NOT RUN ENVIRONMENT |
| Largest declared serving-domain failure during load | `deploy/on-prem/rag/overlays/campus-failover/kustomization.yaml`; `platform/dr/deployment-capacity-profile.template.json` | NOT RUN ENVIRONMENT |
| Bounded memory/queues, no thread explosion, unauthorized disclosure, or OOM under load | `platform/observability/telemetryCollector.ts`; `services/retrieval/ProductionRetrievalWiring.ts`; `services/gpu-scheduler/GpuScheduler.ts`; `tests/unit/productionObservability.test.ts` | NOT RUN ENVIRONMENT |
| Predeclared stage budgets with p50/p95/p99, error/overload rate, saturation, and headroom | `scripts/readiness/production-rag-load-lib.mjs`; `scripts/readiness/production-rag-load.mjs`; `tests/unit/productionRagLoad.test.ts`; `docs/production-rag-evidence.md` | VERIFIED LOCAL for evidence schema and pass/fail boundedness logic; NOT RUN ENVIRONMENT for actual benchmark results |

## Track 8 observability requirements

| Requirement | Current implementation/tests | Status |
| --- | --- | --- |
| Bounded RED request metrics | `platform/observability/productionObservability.ts`; `tests/unit/productionObservability.test.ts` | VERIFIED LOCAL |
| Bounded USE resource metrics | `platform/observability/productionObservability.ts`; `tests/unit/productionObservability.test.ts` | VERIFIED LOCAL |
| Controlled request/stage/retrieval histograms | `platform/observability/productionObservability.ts`; `tests/unit/productionObservability.test.ts` | VERIFIED LOCAL |
| Governed HMAC request/turn/retrieval/decision/index-generation/trace references | `platform/observability/governedCorrelation.ts`; `tests/unit/productionObservability.test.ts` | VERIFIED LOCAL |
| Content-free traces | `platform/observability/productionObservability.ts`; `platform/observability/telemetryCollector.ts`; `tests/unit/productionObservability.test.ts` | VERIFIED LOCAL |
| Cardinality caps and forbidden telemetry attributes | `platform/observability/productionObservability.ts`; `platform/observability/telemetryCollector.ts`; `tests/unit/productionObservability.test.ts` | VERIFIED LOCAL |
| Exporter queue bounds, backpressure, failure, and drop accounting | `platform/observability/telemetryCollector.ts`; `tests/unit/productionObservability.test.ts` | VERIFIED LOCAL |
| Production OTLP exporter rejects external/path/query/redirect destinations, bounds responses, honors cancellation, excludes Audit and protected data | `platform/observability/otlpExporter.ts`; `tests/unit/otlpExporter.test.ts` | VERIFIED LOCAL |
| Safe overload/dependency/Audit/authorization anomaly signals | `platform/observability/productionObservability.ts`; `tests/unit/productionObservability.test.ts` | VERIFIED LOCAL |
| Collector-side allowlisting and payload sanitization | `deploy/on-prem/rag/base/observability.yaml`; `platform/deployment/check-rag-manifests.mjs`; `tests/security/deployment/ragManifests.test.ts` | VERIFIED LOCAL for manifest/static contract; NOT RUN ENVIRONMENT for live collector config load and telemetry flow |
| Dashboard, alert routing, exporter integration, and retention artifacts | `deploy/on-prem/rag/base/observability.yaml`; `platform/deployment/check-rag-manifests.mjs`; `tests/security/deployment/ragManifests.test.ts` | VERIFIED LOCAL for artifacts/static checks only; NOT RUN ENVIRONMENT for live backend delivery, alert delivery, access control, retention purge, and HA |
| Operational logs remain separate from authoritative Audit | `platform/observability/telemetryCollector.ts`; `services/audit/AuditLedger.ts`; `docs/production-rag-runbook.md`; `docs/production-rag-threat-model.md` | VERIFIED LOCAL |

## Required deliverables and production evidence

| Deliverable/gate | Current artifact | Status |
| --- | --- | --- |
| Production code and generated contracts | Service implementations and `contracts/`; root `npm run typecheck` passed | VERIFIED LOCAL |
| Database schemas/migrations with rollback compatibility | Schemas under `services/` and `contracts/`; no database rollback exercise recorded | NOT RUN ENVIRONMENT |
| On-prem manifests, policies, secret references, probes, disruption budgets, scaling, resource limits | `deploy/on-prem/rag/`; `platform/deployment/check-rag-manifests.mjs`; `tests/security/deployment/ragManifests.test.ts` | VERIFIED LOCAL; NOT RUN ENVIRONMENT |
| Unit, contract, integration, security, chaos, and load tests | Unit/integration/security files exist; focused Track 8 observability/deployment tests and the production-path load harness tests are verified locally; no integrated environment load/chaos evidence identified | VERIFIED LOCAL for harness/test implementation; NOT RUN ENVIRONMENT for executed load/chaos gates |
| Production operations runbook | `docs/production-rag-runbook.md` | VERIFIED LOCAL |
| Threat model | `docs/production-rag-threat-model.md` | VERIFIED LOCAL |
| Evidence ledger with truthful unresolved gates | `docs/production-rag-evidence.md` | VERIFIED LOCAL |
| Authenticated publication-authority operator CLI with CAS, fence, Audit, and bounded output enforcement | `platform/operators/indexPublicationClient.mjs`; `scripts/operators/index-publication.mjs`; `tests/unit/indexPublicationCli.test.ts`; `docs/production-rag-runbook.md` | VERIFIED LOCAL; NOT RUN ENVIRONMENT |
| ADR for every architecture deviation | No Track 8 architecture deviation was declared; completeness across all implementation tracks was not audited here | NOT RUN ENVIRONMENT |
| Final requirement-to-file/test traceability matrix | `docs/production-rag-traceability.md` | VERIFIED LOCAL |
| Hardware/model/corpus/index digest and benchmark evidence | `docs/production-rag-evidence.md` records these as absent | NOT RUN ENVIRONMENT |
| Production zero-egress, mTLS, HSM/key rotation, load, HA, restore, DR, and failover evidence | Required environment unavailable; gates remain listed in `docs/production-rag-evidence.md` | NOT RUN ENVIRONMENT |

## Verdict

The scoped Track 8 implementation, observability deployment artifacts, focused tests, and root TypeScript compilation are locally verified. `VERIFIED LOCAL` for observability deployment means repository artifacts and static acceptance checks exist; it does not prove live service emission, collector config load in a cluster, backend delivery, alert delivery, access control, retention purge, or HA behavior. The platform remains `PRODUCTION NO-GO` because integrated authorization/security, live telemetry backend outage/access-control/retention purge/alert-delivery/HA evidence, hardware/load, mTLS/HSM, failure-domain, backup/restore, DR, and campus-failover evidence is not recorded.
