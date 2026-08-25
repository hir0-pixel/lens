# Provider adapters and company RAG profiles

## Canonical adapter contract

`services/model-provider/ProviderAdapter.ts` is the only in-repo provider interface. Orchestrator, RAG, and UI must not import OpenAI or Gemini SDKs.

Required operations: `discoverModels`, `getModelCapabilities`, `generateStream`, `embed` (optional), `health`, `normalizeError`, `meterUsage`.

Factory: `createModelProviderAdapter(config, fetcher?, secretStore?)` keyed by `adapter_type`.

| Profile | Allowed adapters | Endpoint |
|---|---|---|
| sovereign | `openai-compatible` only | HTTPS or loopback HTTP, internal/loopback host |
| development | `openai-compatible`, `gemini-dev` | Gemini is isolated and forbidden in sovereign |

## Provider Registry

Durable records live in `services/provider-registry` (SQLite via `PROVIDER_REGISTRY_PATH` in this process). Fields: provider id, adapter type, internal base URL, **secret reference** (never plaintext), TLS workload ref, allowed model ids/patterns, capability flags, timeout/concurrency, state (`active`/`disabled`/`unhealthy`), catalog version, timestamps, idempotency key.

`SecretStore` (`services/secrets/SecretStore.ts`) accepts the admin-submitted key, encrypts it (when `SECRET_STORE_KEY` is set), and exposes it only to the adapter as `LENS_SECRET_<secret_ref>`.

The BFF now splits internal provider access into two scopes:

- `CATALOG_WORKLOAD_TOKEN` can read the approved model snapshot and provider runtime config.
- `PROVIDER_SECRET_WORKLOAD_TOKEN` can resolve only the short-lived opaque handle returned by the runtime-config route.

The runtime-config response no longer exposes the registry's real `secretRef`; it mints a short-lived server-held capability handle, and `/internal/v1/provider-secret/:secretRef` will return the plaintext key only when that handle is still valid and the caller presents the dedicated provider-secret token.

Discovery calls the OpenAI-compatible `GET /v1/models` endpoint from the server/runtime network, then keeps ids that match the allowlist and `^[a-z0-9][a-z0-9._-]{0,63}$`. Disabled/unhealthy providers are omitted from the employee catalog and fail closed if submitted.

Reusing an idempotency key with a different canonical input (including a different key fingerprint) conflicts; it does not overwrite.

## BFF and Orchestrator

- Employee catalog: `GET /api/models` (session). Filtered by `CompanyRagProfile.eligibleModelPatterns` when a profile is configured.
- Admin onboarding: CSRF-protected `/api/admin/providers*` for subjects in `ADMIN_SUBJECTS`.
- Orchestrator live check: `LENS_APPROVED_CATALOG_URL` + `SnapshotEmployeeCatalog`. Employee `model_ref` cannot change retrieval authorization, corpus, grounding, audit identity, conversation ownership, or tool grants.

Employee model selection must be allowlisted by `CompanyRagProfile.eligibleModelPatterns` and does not change signed grounding policy, retrieval corpora, or authorization. RAG customization stays versioned in `CompanyRagProfile` with no company-name branches in routing or adapter code.

## Retrieval profile lineage

Every retrieval request carries `profile_version` and a canonical-SHA-256 `profile_digest` for the complete `CompanyRagProfile` that resolved its corpus and mode. Retrieval treats both as opaque pass-through values, includes them in the signed context manifest, and mirrors them on successful context results.

The orchestrator captures this identity per request and reuses that capture at the generation context fence and in terminal evidence. It fails closed before generation if either the returned manifest or mirrored result profile version/digest differs, including a stale lower version or same-version content mismatch.

## Scheduler and attempts

Production sidecar: `SqlGpuScheduler` + `LENS_SCHEDULER_CELL_ID`. Durable attempt generations are `(logical_attempt_id, generation)` with `OUTCOME_UNKNOWN` non-replay. Provider onboarding does not replace lease/attempt/cost contracts.

## Physical production

This document does not claim GO. Cluster PostgreSQL, mTLS, and live failover remain open.
