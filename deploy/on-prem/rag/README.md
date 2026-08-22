# Governed Policy RAG Production Runbook

This runbook is an admission checklist, not proof that a particular cluster has passed it.

## Required topology

- L7 gateway across at least two failure domains.
- At least three stateless BFF/RAG coordinator replicas; readiness probe `GET /ready`, liveness probe `GET /health`.
- Immutable, read-only corpus publication mounted by generation or served by the approved object/content service.
- Replicated authorization and audit authorities; both fail closed.
- Controlled outbound route only to the approved Gemini API endpoint for the `gemini_external` profile. No generic NAT fallback.
- Durable ingestion queue, idempotent workers, quarantine/dead-letter storage, transactional outbox, and atomic publication pointer.
- Independent lexical/vector index copies and a bounded shared candidate-reference cache. Final authorization decisions and protected generated answers are not cached.

## Required environment

```text
NODE_ENV=production
RAG_MODE=governed_policy
RAG_CORPUS_ROOT=/var/lib/lens/corpus/<immutable-generation>
RAG_CORPUS_REF=<approved-corpus-id>
RAG_AUTHORIZATION_URL=https://<internal-pdp>/v1/authorize
RAG_AUDIT_URL=https://<internal-audit>/v1/admissions
RAG_AUTHORITY_TOKEN=<short-lived-workload-token>
```

All other RAG limits are set from the signed deployment capacity profile. Secrets are injected through the workload secret manager, never baked into an image or ConfigMap.

## Capacity floor

The canonical campaign covers 1,300 concurrent generations, at least 43 starts/s at a 30-second mean duration, a five-minute 86 starts/s burst, 500 accepted gateway requests/s, and retrieval at 100/500/1,000 candidate classes. Set replica concurrency below the measured collapse point and reserve finalization, authorization, audit, cancellation, and recovery capacity.

Autoscale serving on active requests, context bytes, p95/p99 latency, event-loop saturation, and downstream in-flight calls. Autoscale ingestion independently on queue item/byte/age. Queue depth is backlog, not serving capacity.

## Release and rollback

1. Publish an immutable corpus/index generation without making it active.
2. Verify digests, source revisions, searchable copies, authorization, audit, relevance, abstention, citation accuracy, and restore evidence.
3. Canary 1-5%, then 10%, 50%, and 100%, comparing error rate, finalized-answer latency, no-context rate, authorization/audit failures, and grounded-answer accuracy.
4. Roll back application traffic immediately on regression. Corpus rollback is a new forward, revalidated publication; never repoint blindly to an older security revision.

## Production admission

Do not declare production readiness until load, soak, cancellation-storm, prompt-injection, ACL-revision race, audit/PDP outage, index-domain loss, backup/restore, secret rotation, and controlled-egress campaigns pass on the exact release digests and infrastructure profile.
