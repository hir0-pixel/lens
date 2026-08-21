# Production RAG Operations Runbook

## Scope and operating rule

This runbook covers deployment, rollback, observability response, key rotation, index rollback, dependency outage, overload, backup/restore, and campus failover for the on-premises RAG platform. It does not replace the authoritative Audit ledger or the service-owner recovery procedures.

Production actions require a ticket/incident identifier, two-person approval for security or recovery mutations, and an Audit admission receipt before protected state changes. Stop if Audit quorum, secure time, workload identity, HSM access, or the sovereign network boundary cannot be verified. Never put prompts, outputs, chunks, raw user/session/subject identifiers, credentials, tokens, or secrets in command arguments, tickets, metrics, traces, or ordinary logs.

## Owners

| Role | Responsibility |
| --- | --- |
| Release Manager | Coordinates release, rollback, evidence capture, and final go/no-go. |
| Platform Operations | Kubernetes deployment, capacity, exporter health, backup jobs, and failover execution. |
| Security Operations | Incident command, workload identity, mTLS, HSM/key rotation, and zero-egress verification. |
| Audit Owner | Confirms Audit admission, quorum, continuity, and post-action evidence. |
| Retrieval/Index Owner | Publication manifest, index-state writer, activation, rollback, and refeed/delete reconciliation. |
| Data Owner | Approves restore scope and validates owner authority heads and policy state. |
| Model Serving Owner | GPU/model saturation, admission limits, cancellation, and dependency recovery. |

## Common checks

Run from the repository root using an authenticated administration workstation on the management network.

```powershell
npm run rag:check
kubectl kustomize deploy/on-prem/rag/overlays/production
kubectl diff -k deploy/on-prem/rag/overlays/production
kubectl get nodes -o wide
kubectl get pods -n lens-rag -o wide
kubectl get networkpolicy -n lens-rag
kubectl get events -n lens-rag --sort-by=.lastTimestamp
```

Record command, UTC time, operator, cluster/context, release digest, exit code, and evidence location in `docs/production-rag-evidence.md` or the controlled release evidence system. Do not paste secret-bearing output.

## Load evidence harness

Owner: Release Manager with Platform Operations, Retrieval/Index Owner, and Model Serving Owner.

Use the bounded synthetic readiness harness only against the internal HTTPS Orchestrator `/v1/chat` or Retrieval `/v1/retrieve` endpoints. Use mTLS files and a workload-token file for both modes. Never pass token contents on the command line. The harness records only aggregate counts, latencies, typed failures, boundedness signals, and operator-supplied immutable digests. It does not certify production readiness by itself.

Prepare the environment on an authenticated internal workstation:

```powershell
$env:LENS_RAG_LOAD_CA_FILE = "C:\secure\rag-load\ca.pem"
$env:LENS_RAG_LOAD_CERT_FILE = "C:\secure\rag-load\client-cert.pem"
$env:LENS_RAG_LOAD_KEY_FILE = "C:\secure\rag-load\client-key.pem"
$env:LENS_RAG_LOAD_WORKLOAD_TOKEN_FILE = "C:\secure\rag-load\orchestrator.token"
$env:LENS_RAG_LOAD_ENVIRONMENT_DIGEST = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
$env:LENS_RAG_LOAD_MODEL_DIGEST = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
$env:LENS_RAG_LOAD_CORPUS_DIGEST = "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
$env:LENS_RAG_LOAD_INDEX_DIGEST = "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
$env:LENS_RAG_LOAD_ARTIFACT_DIGEST = "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
```

Sustained + burst + cancellation + fault-observation + recovery-surge on the production request path:

```powershell
npm run readiness:production-rag-load -- --mode chat --endpoint https://orchestrator.rag.platform.internal/v1/chat --target-rate 43 --connected-sessions 1000 --max-inflight 160 --sustained-ms 1800000 --burst-multiplier 1.25 --burst-ms 300000 --cancellation-fraction 0.1 --cancel-after-ms 1500 --cancellation-ms 300000 --fault-ms 300000 --recovery-rate 30 --recovery-ms 300000 --output docs/evidence/production-rag-chat-load.json
```

During the `fault-ms` window, an authorized external fault tool may disrupt the approved dependency. The harness only observes and records typed failures; it does not inject faults itself.

Retrieval candidate-envelope observation runs:

```powershell
npm run readiness:production-rag-load -- --mode retrieve --endpoint https://retrieval.rag.platform.internal/v1/retrieve --candidate-limit 100 --target-rate 86 --connected-sessions 500 --max-inflight 200 --sustained-ms 600000 --output docs/evidence/production-rag-retrieve-100.json
npm run readiness:production-rag-load -- --mode retrieve --endpoint https://retrieval.rag.platform.internal/v1/retrieve --candidate-limit 500 --target-rate 86 --connected-sessions 500 --max-inflight 200 --sustained-ms 600000 --output docs/evidence/production-rag-retrieve-500.json
npm run readiness:production-rag-load -- --mode retrieve --endpoint https://retrieval.rag.platform.internal/v1/retrieve --candidate-limit 1000 --target-rate 86 --connected-sessions 500 --max-inflight 200 --sustained-ms 600000 --output docs/evidence/production-rag-retrieve-1000.json
```

If achieved rate, headroom, pacing lag, or backlog boundedness fails, the harness exits non-zero and the run is not a PASS. Record the produced JSON, UTC time, operator, declared digests, and any external fault ticket/change reference in `docs/production-rag-evidence.md` or the approved evidence system. Until a real environment run occurs, keep the corresponding gate marked `NOT RUN`.

## Deploy

Owner: Release Manager. Executors: Platform Operations and service owners.

1. Confirm the release uses immutable image and contract digests, has an approved rollback digest, and passed the release-specific security and compatibility gates.
2. Confirm Audit admission and current workload/key/revocation epochs.
3. Render and diff the canary overlay, then apply it.

```powershell
kubectl kustomize deploy/on-prem/rag/overlays/canary
kubectl diff -k deploy/on-prem/rag/overlays/canary
kubectl apply -k deploy/on-prem/rag/overlays/canary
kubectl rollout status deployment/lens-bff -n lens-rag --timeout=10m
kubectl rollout status deployment/lens-orchestrator -n lens-rag --timeout=10m
kubectl rollout status deployment/lens-retrieval -n lens-rag --timeout=10m
```

4. Hold the canary for the approved observation interval. Verify RED/USE metrics, authorization-denial distribution, no-context rate, Audit admissions, telemetry drops, exporter failures, and queue saturation. Do not promote with missing telemetry or Audit evidence.
5. Apply production and verify every workload.

```powershell
kubectl apply -k deploy/on-prem/rag/overlays/production
kubectl rollout status deployment/lens-bff -n lens-rag --timeout=10m
kubectl rollout status deployment/lens-orchestrator -n lens-rag --timeout=10m
kubectl rollout status deployment/lens-retrieval -n lens-rag --timeout=10m
kubectl rollout status deployment/lens-ingestion -n lens-rag --timeout=10m
kubectl get pods -n lens-rag -o wide
```

Stop and roll back on authorization bypass/failure spikes, Audit admission failure, unexpected egress, stale index publication state, sustained saturation, increasing telemetry drops, or contract mismatch.

## Rollback

Owner: Release Manager. Approval: Security Operations and affected service owner.

Use the approved prior release bundle/digest. `kubectl rollout undo` is an emergency containment tool only; declarative state must then be restored to the approved prior release.

```powershell
kubectl rollout undo deployment/lens-bff -n lens-rag
kubectl rollout undo deployment/lens-orchestrator -n lens-rag
kubectl rollout undo deployment/lens-retrieval -n lens-rag
kubectl rollout undo deployment/lens-ingestion -n lens-rag
kubectl rollout status deployment/lens-bff -n lens-rag --timeout=10m
kubectl rollout status deployment/lens-orchestrator -n lens-rag --timeout=10m
kubectl rollout status deployment/lens-retrieval -n lens-rag --timeout=10m
kubectl rollout status deployment/lens-ingestion -n lens-rag --timeout=10m
```

Re-run admission, authorization, retrieval, Audit, no-egress, and schema compatibility checks. Do not roll back owner-policy, revocation, key, or index generations merely because application code was rolled back.

## Key rotation

Owner: Security Operations. Co-approver: Audit Owner. HSM commands are vendor/deployment-specific and are intentionally not invented here; the approved HSM procedure and output digest must be attached to the change record.

1. Create the new non-exportable purpose-specific key in the on-premises HSM under dual control. Never print key material.
2. Audit-admit the new key ID and activation epoch. Keep the old key verify-only during the overlap window.
3. For observability correlation, issue a new governed key ID and secret reference. New references use the new key immediately; old references remain resolvable only through controlled lookup for the retention window. Raw identifiers must never be used as a fallback.
4. Restart only workloads that consume the rotated reference, one availability domain at a time, and verify issuance, verification, telemetry acceptance, and drop accounting.

```powershell
kubectl get pods -n lens-rag -o wide
kubectl rollout status deployment/lens-bff -n lens-rag --timeout=10m
kubectl rollout status deployment/lens-orchestrator -n lens-rag --timeout=10m
kubectl rollout status deployment/lens-retrieval -n lens-rag --timeout=10m
```

5. Revoke the old key only after the maximum lease/verification overlap, evidence completeness, and owner approval. On failure, stop issuance with the new key, revert the reference to the old verify/issue epoch through the approved secrets control plane, and Audit-admit the rollback.

## Index publication and rollback

Owner: Retrieval/Index Owner. Co-approver: Data Owner.

Only the single index-state writer may activate or roll back a publication. Never mutate Qdrant/Vespa collections directly and never infer authority from a search engine's local generation.

1. Verify the candidate publication manifest, source/content digest, embedding/model digest, schema, searchable-copy count, authorization metadata contract, and delete/refeed reconciliation.
2. Audit-admit activation and capture the visibility sequence and prior generation.
3. From a privileged access workstation on the management network, point the operator CLI only at the publication-authority control plane. The endpoint must be an internal HTTPS origin. Use mTLS files and the short-lived workload token file; never paste token contents into arguments or logs. The workload token file, if used, must contain at least 32 bytes.
4. The fence file must contain the complete signed single-use PAM fence envelope. At minimum it must carry the fence ID, target, operation, canonical payload digest, ticket reference, purpose reference, issued-at time, expiry time, nonce, and signature. The CLI verifies locally that the operation, target, and canonical planned payload digest match the requested mutation, but the Publication Controller remains authoritative for signature validation, live policy checks, and atomic nonce consumption. Never print the fence file contents.

```powershell
$env:LENS_PUBLICATION_AUTHORITY_URL = "https://publication-authority.rag.platform.internal"
$env:LENS_PUBLICATION_CA_FILE = "C:\secure\publication-authority\ca.pem"
$env:LENS_PUBLICATION_CERT_FILE = "C:\secure\publication-authority\operator-cert.pem"
$env:LENS_PUBLICATION_KEY_FILE = "C:\secure\publication-authority\operator-key.pem"
$env:LENS_PUBLICATION_TOKEN_FILE = "C:\secure\publication-authority\operator-workload.token"
$env:LENS_PUBLICATION_DEADLINE_MS = "10000"

npm run operator:index-publication -- status --corpus enterprise-docs
npm run operator:index-publication -- activate --corpus enterprise-docs --expected-visibility-sequence 41 --target-generation gen-2026-08-21-02 --source-revision-digest sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa --governance-revision-digest sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc --searchable-copy-evidence-ref copy-proof-2026-08-21-02 --idempotency-key activate-2026-08-21-02 --reason "promote verified searchable copy quorum" --change-reference CHG-2401 --fence-file C:\secure\publication-authority\fence-activate.json
npm run operator:index-publication -- rollback --corpus enterprise-docs --expected-visibility-sequence 42 --expected-active-generation gen-2026-08-21-02 --target-generation gen-2026-08-20-99 --source-revision-digest sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd --governance-revision-digest sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee --searchable-copy-evidence-ref copy-proof-2026-08-20-99 --idempotency-key rollback-2026-08-21-02 --reason "rebuild forward-safe rollback generation after anomaly spike" --change-reference CHG-2402 --fence-file C:\secure\publication-authority\fence-rollback.json
npm run operator:index-publication -- refeed --corpus enterprise-docs --expected-visibility-sequence 42 --target-generation gen-2026-08-21-03 --source-revision-digest sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb --governance-revision-digest sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff --idempotency-key refeed-2026-08-21-03 --reason "schedule inactive rebuild after delete reconciliation" --change-reference CHG-2403 --fence-file C:\secure\publication-authority\fence-refeed.json
```

5. Activate only after `status` confirms the expected current visibility sequence. Record the CLI JSON output, UTC time, operator, change reference, and the Audit receipt returned by the Publication Controller in the evidence ledger. The output must stay bounded and content-free.
6. After `activate`, verify every searchable copy reports the same active generation and visibility sequence before ingestion cleanup. Keep the prior generation ID and prior visibility sequence with the change record.
7. If error/no-context/authorization anomalies rise, fence the new generation and run the explicit rollback command with the recorded active generation, target retired generation, target source revision digest, target governance revision digest, and searchable-copy evidence. Do not infer "last known good" implicitly, and do not reactivate a stale governance view in place.
8. Refeed only schedules a new inactive generation. It must never mutate the active generation in place. Capture the returned target generation, retained active generation, and unchanged/current visibility sequence in evidence.
9. Post-verification: re-run `status`, validate searchable-copy evidence, confirm the controller-returned Audit receipt and continuity, and attach the CLI JSON plus publication/searchable-copy verification output to the evidence system.

## Overload

Incident owner: Platform Operations. Model Serving Owner handles inference saturation.

1. Confirm active requests, queue depth, admission rejections, GPU/KV-cache saturation, worker-pool saturation, latency histograms, cancellation completion, and exporter drops.
2. Preserve bounded admission. Do not raise queue limits during an incident. Reject excess work with the documented overload response and retry guidance.
3. Prioritize already-admitted interactive work and cancellation cleanup. Pause ingestion/background jobs before protected interactive paths.
4. Scale only within measured hardware and policy envelopes.

```powershell
kubectl get hpa -n lens-rag
kubectl top pods -n lens-rag
kubectl get pods -n lens-rag -o wide
kubectl get events -n lens-rag --sort-by=.lastTimestamp
```

Reopen background work gradually. Watch for a recovery stampede and keep admission bounded until queues, exporter backlog, and dependency latency return to baseline.

## Dependency outage

Incident owner: affected service owner. Security Operations owns identity/PDP/Audit outages.

| Dependency | Required behavior |
| --- | --- |
| Identity/PDP/Governance | Fail protected admission closed; do not use cached authorization decisions beyond their explicit fence. |
| Audit | Fail Class A protected admission closed; operational logs are not a substitute. |
| Retrieval/index | Return the explicit no-context/degraded result; never bypass authorization or silently use a stale publication. |
| Model serving | Cancel/reject bounded work; do not route externally. |
| Telemetry exporter | Keep the local queue bounded, count failures/backpressure/drops, and preserve service availability. |
| Secrets/HSM/secure time | Deny new security-sensitive operations when validity cannot be established. |

After recovery, rate-limit probes and retries, validate dependency generation/epoch, and drain bounded queues gradually. Do not release accumulated work in a single burst.

Retrieval startup fails closed unless `LENS_RETRIEVAL_PDP_URL`, `LENS_RETRIEVAL_INDEX_URL`, `LENS_RETRIEVAL_CONTENT_URL`, `LENS_RETRIEVAL_AUDIT_URL`, `LENS_RETRIEVAL_PUBLICATION_URL`, and their separate `*_WORKLOAD_TOKEN` values are present. Production endpoints must be HTTPS internal origins. Loopback HTTP is test/development-only and cannot be enabled in production by `LENS_RETRIEVAL_ALLOW_LOOPBACK_HTTP`.

Retrieval requests carry both `query_digest` and bounded `query_text`: maximum 8,192 Unicode characters, maximum 32,768 UTF-8 bytes, and maximum 48 KiB HTTP request body. Ingress verifies `sha256(query_text) == query_digest` before any PDP, publication, index, content, or Audit call.

Publication returns bounded active-generation metadata only. Retrieval pins `indexGeneration`, `visibilitySequence`, and `sourceRevisionDigest` into the search request; the search broker must echo the pinned generation and visibility or Retrieval fails closed. Live PDP/Governance authorization and content-hash verification remain authoritative for withdrawal/deletion and protected bytes.

## Backup and restore

Owners: Platform Operations and Data Owner. Approvals: Security Operations and Audit Owner.

Trigger a one-off encrypted backup from the declared CronJob and retain the job name in evidence:

```powershell
kubectl create job --from=cronjob/rag-state-backup rag-state-backup-manual -n lens-rag
kubectl wait --for=condition=complete job/rag-state-backup-manual -n lens-rag --timeout=60m
kubectl logs job/rag-state-backup-manual -n lens-rag
```

Logs must contain only references/digests, never restored content or key material. Restore only in the separate-trust restore cell described by `platform/dr/recovery-runbook.md`. Trigger verification with a unique approved job name; do not restore into the active production namespace.

```powershell
kubectl create job --from=cronjob/rag-restore-verification rag-restore-verification-manual -n lens-rag
kubectl wait --for=condition=complete job/rag-restore-verification-manual -n lens-rag --timeout=120m
kubectl logs job/rag-restore-verification-manual -n lens-rag
```

Acceptance requires signed manifest verification, Audit ledger continuity, current key/revocation epochs, owner authority heads, known-good artifacts, authorization regression, and cleanup/zeroization evidence. A command exit code alone is insufficient.

## Campus failover

Incident owner: Security Operations. Executor: Platform Operations. Approval: Audit Owner and executive incident authority.

1. Declare the incident and fence the former primary generation before DNS/load-balancer movement.
2. Verify target capacity, HSM/secrets recovery, secure time, Audit checkpoint freshness, owner authority heads, and replicated state.
3. Render/diff the failover overlay, then apply only after the signed recovery manifest is accepted.

```powershell
kubectl kustomize deploy/on-prem/rag/overlays/campus-failover
kubectl diff -k deploy/on-prem/rag/overlays/campus-failover
kubectl apply -k deploy/on-prem/rag/overlays/campus-failover
kubectl rollout status deployment/lens-bff -n lens-rag --timeout=15m
kubectl rollout status deployment/lens-orchestrator -n lens-rag --timeout=15m
kubectl rollout status deployment/lens-retrieval -n lens-rag --timeout=15m
kubectl rollout status deployment/lens-ingestion -n lens-rag --timeout=15m
```

4. Reopen traffic only through the target-side gate after ledger completeness and authorization tests pass. Keep the old campus fenced until reconciliation proves a single authority.
5. A drill may be launched from the declared CronJob, but it does not authorize real traffic movement.

```powershell
kubectl create job --from=cronjob/rag-campus-failover-drill rag-campus-failover-drill-manual -n lens-rag
kubectl wait --for=condition=complete job/rag-campus-failover-drill-manual -n lens-rag --timeout=120m
kubectl logs job/rag-campus-failover-drill-manual -n lens-rag
```

## Observability response

Page the owning service and Platform Operations for sustained request errors/latency, saturation, queue drops, exporter failures, or cardinality rejections. Page Security Operations and Audit Owner immediately for authorization failure spikes, all-denied/no-context anomalies, stale publication manifests, Qdrant replica loss, PDP/Governance latency, Audit quorum loss, or recovery stampedes.

Telemetry is content-free operational evidence. Use governed references to pivot into authorized systems. Never copy protected content into dashboards or traces, and never treat missing telemetry as proof that an action did not occur.

The deployed OTel Collector gateway must keep `memory_limiter`, `filter/sovereign_payload_guard`, `transform/sovereign_sanitize`, and `batch` in that order for metrics, logs, and traces. The sanitizer drops span events, rewrites arbitrary log bodies to the fixed operational marker, keeps only the approved low-cardinality attributes, and exports only to internal mTLS telemetry backends. If the sanitizer processor is absent, misordered, or rejected by the collector version, stop promotion and treat telemetry delivery as unavailable until fixed.
