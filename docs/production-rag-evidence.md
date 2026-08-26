# Production RAG Evidence Ledger

## Local / live-provider lab evidence (Track: Provider RAG developer tasks)

| Field | Recorded value |
| --- | --- |
| Evidence date | 2026-08-26 |
| Commit | `df17b02d48ae325835b30c71fec9404ba6ece201` |
| Handoff report | `docs/rag-final-provider-handoff-report.md` |
| Live smoke | `npm run smoke:task9` — PASS (0 failures) against local IdP/BFF/orchestrator/runtime |
| Provider adapter | `openai-compatible` (`PROVIDER_PROFILE=development` lab) |
| Physical production gates below | unchanged — still NOT RUN / NO-GO |

---

## Evidence rules

This file records observed evidence only. `PASS` means the listed command completed successfully in the stated environment. `NOT RUN` means no evidence was produced and the gate remains open. Unit/typecheck success does not establish hardware, security, load, HA, restore, DR, or production readiness.

Evidence must be stored on company-controlled infrastructure. Do not attach prompts, outputs, chunks, raw identities/session IDs, credentials, tokens, key material, or unrestricted logs.

## Environment profile

| Field | Recorded value |
| --- | --- |
| Evidence date | 2026-08-21 |
| Repository | `D:\Lens\lens` |
| Host OS | Windows (exact build not captured) |
| Node.js | v25.8.0 |
| npm | Pending capture with local validation |
| Test runner | Vitest 3.2.4 from repository lock/package metadata |
| TypeScript | 5.8.x from repository lock/package metadata |
| Kubernetes context/cluster | NOT RUN / not connected for this Track 8 task |
| Hardware/GPU profile | NOT RUN / not supplied |
| Identity/mTLS/HSM profile | NOT RUN / not supplied |
| Corpus digest | NOT RUN / no production corpus used |
| Model/adapter digest | NOT RUN / no model used |
| Index/publication digest | NOT RUN / no production index used |
| Container/release digest | NOT RUN / no deployment performed |

## Local gates for Track 8

| Gate | Command | Status | Observed result |
| --- | --- | --- | --- |
| Focused index-publication operator tests | `npx vitest run tests/unit/indexPublicationCli.test.ts` | PASS | 1 test file passed; 8/8 tests passed. Covered internal endpoint enforcement, no datastore host targeting, 32-byte workload-token minimum, controller-owned Audit receipt enforcement, signed fence-envelope payload matching, rollback forward-safe evidence requirements, stale conflict fail-closed behavior, redirect/oversize/invalid response rejection, cancellation/deadline propagation, and sanitized CLI output. |
| Focused observability unit test | `npx vitest run tests/unit/productionObservability.test.ts` | PASS | 1 test file passed; 7/7 tests passed. |
| Focused OTLP exporter and observability deployment tests | `npx vitest run tests/unit/otlpExporter.test.ts tests/unit/productionObservability.test.ts tests/security/deployment/ragManifests.test.ts` | PASS | 3 test files passed; 22/22 tests passed. |
| Focused production RAG load harness tests | `npm run test:readiness` | PASS | 1 test file passed; 8/8 tests passed. Covered internal endpoint validation, mTLS file and workload-token-file enforcement, exact `retry_budget=0`, exact query-digest binding, bounded concurrency/pacing, content-free evidence/output redaction, retrieval candidate envelopes 100/500/1,000, cancellation, typed dependency-failure and recovery observation, redirect rejection, oversized-response rejection, and schema-versioned evidence-file output. This verifies the harness implementation locally only; it does not establish any environment load result. |
| Static RAG manifest acceptance checker | `node platform/deployment/check-rag-manifests.mjs` through `tests/security/deployment/ragManifests.test.ts` | PASS | Verified collector gateway artifacts, collector-side payload guard, fixed attribute allowlist sanitizer, bounded OTel queues/retry, internal-only endpoints, alert rules, Grafana provisioning, retention policy, workload identity and no public Service exposure. This does not prove live service emission or backend delivery. |
| Direct manifest acceptance checker | `node platform/deployment/check-rag-manifests.mjs` | PASS | Track 7 deployment check passed for 14 manifest files, including observability. |
| Root typecheck | `npm run typecheck` | PASS | Contract generation and `tsc --noEmit` completed successfully. |
| Production security gate | `npm run security:production` | PASS | Production build security gate passed. |
| Full repository validation | `npm run validate` | PASS | Typecheck, contract checks/provenance, production security gate, orchestrator tests 36/36, retrieval tests 19/19, root tests 228/228 across 47 files, and production build all passed. |

## External and production gates

| Gate | Required command/environment | Status | Blocker/evidence required |
| --- | --- | --- | --- |
| Hardware inference capacity | Approved on-prem GPU pool; workload replay with real model/context distributions | NOT RUN | Hardware/model/capacity profile not supplied. Record TTFT/TPOT, KV use, saturation and headroom. |
| Sustained/burst load | Production-like cluster and synthetic representative corpus; run 30+ minutes plus burst/recovery phases | NOT RUN | No load environment. Must cover 43 generation starts/s or accepted replacement, 2x retrieval stress, and 100/500/1,000 sessions. |
| Candidate envelope | Load harness at 100/500/1,000 candidates/request | NOT RUN | Must record PDP/Governance latency, bounded memory, overload and no unauthorized disclosure. |
| Production-path load/failure harness execution | `npm run readiness:production-rag-load -- ...` against internal `/v1/chat` or `/v1/retrieve` with mTLS files, a workload-token file, operator-supplied immutable digests, and approved external fault injection during the observation phase | NOT RUN | Repository now contains the bounded synthetic production-path harness and focused local tests, but no environment run or resulting evidence JSON is recorded. |
| Query envelope and pinned search | Integrated Retrieval, publication authority, and search broker | NOT RUN | Must prove 8,192-character/32,768-byte query cap, 48 KiB body cap, digest mismatch rejection before dependencies, raw query body-only to configured internal search, and fail-closed search generation/visibility echo mismatch. |
| Zero egress | Isolated production-equivalent network with public DNS/routes blocked and flow monitoring | NOT RUN | Network enforcement evidence absent. |
| mTLS/workload identity | Production-equivalent PKI and service endpoints; negative/rotation/revocation tests | NOT RUN | Certificates, identity endpoints and HSM unavailable. |
| Authorization races | Integrated PDP/Governance/Audit/index/content stack | NOT RUN | Must test stale/expired/replayed fences and policy/group/ACL/classification changes. |
| Audit quorum/admission | Production-equivalent Audit cluster and witness | NOT RUN | Quorum/fail-closed and ledger-completeness evidence absent. |
| Telemetry exporter/retention | Deployed on-prem exporter/backend under outage and access-control tests | NOT RUN | Local artifacts now include bounded OTLP exporter, OTel Collector gateway, collector-side sanitizer, alert/dashboard provisioning, and retention policy. Live service emission, backend delivery, backend outage, access-control, purge, alert delivery and HA evidence remain absent. |
| Dependency failures/recovery surge | Integrated environment with fault injection | NOT RUN | Must cover PDP, Governance, Audit, index, content, model and inference partial failures without retry herd. |
| Rolling N/N-1 deployment | Production-like cluster with live synthetic traffic | NOT RUN | No cluster/release bundle. |
| Index activation/rollback/refeed | Deployed single index-state writer and searchable copies | NOT RUN | Repository now includes an authenticated publication-authority operator CLI and focused local tests. Live deployed single-writer activation/rollback/refeed against searchable copies remains not run in an environment. |
| Backup creation | On-prem backup destination, envelope key and Audit admission | NOT RUN | Backup job not executed. |
| Restore verification | Separate-trust restore cell with signed manifests and cleanup evidence | NOT RUN | Restore cell/HSM/backup set unavailable. |
| Campus failover | Recovery campus with fenced primary and target-side traffic gate | NOT RUN | DR infrastructure unavailable. Must verify Audit ledger completeness after failover. |
| Failure-domain loss | Production-like placement and load harness | NOT RUN | No cluster topology/capacity evidence. |
| Security testing | Integrated environment and approved adversarial test plan | NOT RUN | SSRF, CSRF/CORS, spoofing, direct-call, prompt-injection and zero-egress evidence absent. |

## Benchmark data

No benchmark was run for this Track 8 change. No p50/p95/p99, throughput, saturation, error-rate, overload-rate, or capacity-headroom result is claimed.

## Unresolved production blockers

Production remains `NO-GO` until every applicable external gate above has deployment-specific evidence, owners have accepted the result, and the release references immutable corpus/model/index/artifact digests. In particular, local unit tests cannot validate mTLS, zero egress, HSM rotation, live authorization, exporter behavior, load capacity, restore, or failover.
