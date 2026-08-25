# Provider Key Setup Handoff

## Goal

An authorized administrator registers an internal OpenAI-compatible model gateway once. Employees then select only allowlisted, currently approved `model_ref` values. Retrieval, authorization, audit, conversation ownership, and tool policy do not change with the selected model.

The browser never receives, stores, logs, or re-sends a provider API key after the admin submit. Keys exist only in the server-side `SecretStore`. Persisted provider records store a `secret_ref`, never plaintext.

## Deployment Shape

```text
Employee UI -> BFF -> Orchestrator -> Model Gateway -> Runtime/Provider Adapter -> approved model endpoint
                                |-> Retrieval + live authorization
```

The UI selects a `model_ref`. The BFF and Orchestrator validate that selection against the live Provider Registry catalog and `CompanyRagProfile.eligibleModelPatterns` before the existing governed RAG path runs.

## Administrator procedure

1. Sign in as a subject listed in `ADMIN_SUBJECTS` (comma-separated exact subject ids).
2. Open Settings → Providers, or `POST /api/admin/providers` with CSRF + session cookies.
3. Submit once: `adapterType=openai-compatible`, internal `baseUrl`, `apiKey`, `tlsWorkloadRef`, `allowedModels`, capabilities, timeouts, concurrency, `idempotencyKey`.
4. The BFF validates the origin (sovereign: HTTPS or loopback HTTP, internal/loopback host only), stores the key in `SecretStore`, probes `GET {baseUrl}/v1/models`, keep only allowlisted ids, persists the provider with `secret_ref`.
5. Response is `{ id, status }` only. Same `idempotencyKey` with different input returns `409 IDEMPOTENCY_CONFLICT` and does not overwrite.
6. Refresh later: `POST /api/admin/providers/:id/catalog/refresh`. Disable: `POST /api/admin/providers/:id/disable`.
7. Keep `CompanyRagProfile.eligibleModelPatterns` versioned separately (`COMPANY_RAG_PROFILE_JSON` / `LENS_COMPANY_RAG_PROFILE_JSON`).

## Required environment

BFF:

- `ADMIN_SUBJECTS` — admin SSO subjects
- `PROVIDER_PROFILE` — `sovereign` (default) or `development`
- `PROVIDER_REGISTRY_PATH` — SQLite path for the provider registry (dev/test). Production should use a durable volume; SQLite is not a cluster GO.
- `SECRET_STORE_KEY` — ≥32 chars; AES-256-GCM wrapping for provider keys (`<registry>.secrets`)
- `CATALOG_WORKLOAD_TOKEN` — approved-model catalog and provider runtime-config fetch
- `PROVIDER_SECRET_WORKLOAD_TOKEN` — distinct sidecar→BFF provider-secret fetch token; must not equal `CATALOG_WORKLOAD_TOKEN`
- `COMPANY_RAG_PROFILE_JSON` — versioned RAG profile including `eligibleModelPatterns`
- Existing session/OIDC/CSRF and, for RAG, `RAG_PROVIDER_MODE=internal`, `ORCHESTRATOR_URL`, `ORCHESTRATOR_TOKEN`, assertion keys

Orchestrator:

- `LENS_APPROVED_CATALOG_URL` — e.g. `http://127.0.0.1:3001/internal/v1/approved-models`
- `LENS_APPROVED_CATALOG_TOKEN` — must match `CATALOG_WORKLOAD_TOKEN`
- The BFF never returns the registry's underlying provider `secretRef` over `/internal/v1/provider-runtime-config`; it returns a short-lived opaque handle that is valid only for `/internal/v1/provider-secret/:secretRef` when the caller presents `PROVIDER_SECRET_WORKLOAD_TOKEN`.
- `LENS_COMPANY_RAG_PROFILE_JSON` — same profile as the BFF
- Existing Model Gateway / sidecar / authorities unchanged

Adapter process:

- `LENS_SECRET_<secret_ref>` is materialized by `SecretStore` after put/get. Do not put keys in UI env, git, or logs.

## Endpoints

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/api/models` | authenticated employee | `{ models: [{ modelRef, label, available }] }` — no URLs, keys, or secret refs |
| POST | `/api/admin/providers` | admin + CSRF | body includes `apiKey` once; response `{ id, status }` |
| POST | `/api/admin/providers/:id/disable` | admin + CSRF | |
| POST | `/api/admin/providers/:id/catalog/refresh` | admin + CSRF | |
| GET | `/internal/v1/approved-models` | workload token | Orchestrator snapshot; not a browser route |
| POST | `/api/rag/ask` | employee + CSRF | `modelId` is the `model_ref` only |

Gemini remains `gemini-dev` and is rejected when `PROVIDER_PROFILE=sovereign`. There is no automatic external fallback.

## Employee flow

1. UI `GET /api/models` and populate the existing selector (loading / empty / unavailable / error).
2. Chat submit sends `modelId` (`model_ref`) with the turn. No provider URL or key.
3. BFF rejects unknown/disabled refs. Orchestrator re-validates live catalog + RAG eligibility, then uses the existing governed RAG path (route policy, retrieval authz, Model Gateway leases/attempts/usage).

## Physical production

This document does not claim cluster GO. PostgreSQL HA, mTLS to the provider, and live failover remain evidence gates. An admin can still register an internal OpenAI-compatible gateway in this process, see allowlisted models in the UI, select one, and chat through governed RAG when the rest of the stack is running.
