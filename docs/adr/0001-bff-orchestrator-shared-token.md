# ADR-001: BFF-to-Orchestrator authentication uses a shared workload token in this repository

- Status: Accepted
- Date: 2026-08-21
- Track: 1 (Stable contracts and ownership boundaries)
- Applies to: `server/src/rag/orchestratorClient.ts`, `server/src/config/index.ts`

## Context

Document 024 and the implementation plan require the BFF to authenticate the
internal Orchestrator with **workload identity and mTLS**, and state that "a
shared token alone is insufficient." This repository contains no PKI, SPIFFE,
or service-mesh enrollment: there is no CA, no leaf-cert issuance path, and no
managed identity mechanism available in the build environment.

## Decision

The production BFF RAG path now routes exclusively through
`OrchestratorClient` (see `server/src/index.ts`). Client authentication is a
32+ character shared `ORCHESTRATOR_TOKEN` carried in a header, which is the
repository's existing approved credential pattern (the legacy
`RAG_SERVICE_TOKEN` used the same model).

This is a **deviation** from the mTLS/workload-identity requirement. It is
recorded here rather than editing Documents 001-025.

## Mitigations that narrow the deviation

- The BFF can no longer reach Retrieval or an inference provider directly; all
  internal RAG turns go through the Orchestrator ingress, and only an HTTPS or
  loopback-HTTP endpoint is accepted (`internalServiceUrl` in
  `orchestratorClient.ts`).
- The client cannot choose a trusted identity field or internal endpoint; every
  `subject_ref`, `session_ref`, `device_ref`, and `application_id` is bound
  server-side from the authenticated session.
- The BFF cannot construct an authorization decision; the request carries no
  policy/role/clearance/endpoint/manifest fields (enforced by tests).
- The shared token is a stopgap: the transport boundary is ready for mTLS, and
  no release claims production-readiness (see the implementation report).

## Consequences

- Precondition: an approved secret-management path (Document 025) must inject
  `ORCHESTRATOR_TOKEN`; it is never committed and is rejected in tests if short.
- Follow-up required before PRODUCTION GO: replace the shared token with
  workload-identity + mTLS enrollment at the ingress, then update this ADR to
  Closed.