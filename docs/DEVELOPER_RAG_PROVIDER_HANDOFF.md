# Developer Handoff: Provider Key + Modular RAG

This is the short starting point for a developer/operator who does not know the codebase yet. The app is designed so the browser talks only to the BFF, the BFF stores provider secrets server-side, and chat continues through the governed RAG path.

## Goal

An admin should be able to onboard a provider or internal model gateway, discover/allowlist models, let employees select a model in the UI, and run chat with RAG without exposing provider keys to the browser.

## Main Flow

1. Admin configures the server environment.
2. Admin signs in as a subject listed in `ADMIN_SUBJECTS`.
3. Admin opens Settings -> Providers or calls `POST /api/admin/providers`.
4. BFF stores only a `secret_ref`, discovers provider models, and publishes an approved model catalog.
5. Employees call `GET /api/models` through the UI and submit only `modelRef`/`modelId` with chat requests.
6. Chat flows through BFF -> Orchestrator -> Retrieval/PDP -> Model Gateway -> provider adapter/runtime sidecar.
7. RAG behavior is controlled by `CompanyRagProfile`, not by hard-coded company branches.

## Key Files

- `docs/PROVIDER_KEY_SETUP.md` - detailed provider onboarding and environment reference.
- `docs/PROVIDER_AND_RAG_PROFILE.md` - provider adapter and company RAG profile design.
- `docs/RAG_PRODUCTION_IMPLEMENTATION_REPORT.md` - current implementation status and remaining production gates.
- `server/src/routes/providers.ts` - admin provider onboarding routes.
- `server/src/routes/api.ts` - BFF API composition, including model catalog and RAG routes.
- `services/model-provider/` - provider adapter contract and implementations.
- `services/rag-profile/` - company RAG profile contract.
- `services/retrieval/ProductionRetrievalWiring.ts` - retrieval wiring for lexical/semantic/hybrid modes.
- `services/retrieval/LexicalSearchIndex.ts` and `services/retrieval/VectorSearchIndex.ts` - search backends.
- `services/ingestion/` - document ingestion, publication, embedding, and index adapters.

## Provider Setup

Set these on the BFF/server side. Never put provider keys in the browser.

```env
ADMIN_SUBJECTS=<comma-separated-admin-sso-subjects>
PROVIDER_PROFILE=sovereign
PROVIDER_REGISTRY_PATH=<durable-provider-registry-path>
SECRET_STORE_KEY=<server-side-secret-store-key>
CATALOG_WORKLOAD_TOKEN=<internal-token-for-orchestrator-catalog-read>
COMPANY_RAG_PROFILE_JSON=<company-rag-profile-json>
```

For production, use an internal/self-hosted model gateway or a provider endpoint explicitly approved for the deployment. Public cloud provider APIs are non-sovereign unless the customer formally accepts data egress.

The provider adapter should expose model discovery and generation through the existing model-provider contract. OpenAI-compatible gateways should be preferred for self-hosted/provider-neutral deployments because one adapter can list and call many hosted models.


## Database And Secrets Location

PostgreSQL is not stored inside the desktop UI and should not be treated as part of the browser app. In production it is a company-owned backend database service, usually one of:

- a dedicated internal database VM/server
- an on-prem PostgreSQL HA cluster
- a Kubernetes/stateful database deployment owned by the company

PostgreSQL stores shared durable backend state: provider catalog metadata, RAG corpus/index publication state, ingestion jobs, chat/session/turn metadata, authorization/audit/cost/attempt state, and idempotency/retry records.

Provider API keys should live in a secrets manager or encrypted server-side secret store. PostgreSQL should normally store only a `secret_ref`, not the plaintext key.

For local/demo testing, SQLite/local files are acceptable. For multi-user or multi-replica testing, use PostgreSQL or an equivalent shared durable store so every BFF, Orchestrator, Retrieval, Authority, and ingestion replica sees the same state.

Task 8 live PostgreSQL integration (`tests/unit/pgPool.test.ts`, env `LENS_TEST_DATABASE_URL`): **NOT RUN ENVIRONMENT** — no internal Postgres URL was set in this workspace. Local/demo coverage uses SQLite (`:memory:` or durable files) and production config rejects `:memory:` persistence paths plus missing `SECRET_STORE_KEY`.

Recommended database test progression:

1. Local developer test: SQLite/local files, `npm run validate`.
2. Integration test: one PostgreSQL instance with production-like environment variables.
3. Staging test: PostgreSQL HA or managed internal cluster, multiple service replicas, real secrets backend, and mTLS enabled.
4. Production readiness test: backup/restore, failover, recovery, load, and zero-egress validation.

Minimum database checks before production:

- schema/migrations apply cleanly from an empty database
- every service can start, read, write, and shut down cleanly
- one replica can die without losing committed ingestion, audit, provider catalog, turn, or attempt state
- failover does not return stale or unauthorized RAG content
- backup/restore preserves audit and corpus publication lineage
## RAG Setup

RAG is company-specific and should be changed through configuration and ingestion, not by editing chat code.

Configure `COMPANY_RAG_PROFILE_JSON` / `LENS_COMPANY_RAG_PROFILE_JSON` with:

- corpus references
- retrieval mode: `lexical`, `semantic`, or `hybrid`
- chunk/context limits
- grounding policy
- eligible model patterns
- profile version/digest

Ingest or update documents through the admin ingestion route when enabled. Published corpus generations are atomic: new versions become visible only after publication, and withdrawn/replaced generations must not be returned by retrieval.

## Expected Behavior

- Simple greetings like `hello` or `okay` should not force RAG.
- Policy/manual/document questions should use retrieval when grounding is required.
- `semantic` and `hybrid` must use vector search and fail closed if vectors or the embedding backend are unavailable.
- Unauthorized users must receive no restricted text or citations.
- The model only receives authorized retrieved context.

## Verification Commands

Run these before handing off a build:

```bash
npm run validate
npm run typecheck
npm run lint
npm test
```

Also run the focused RAG/provider suites if changing this area:

```bash
npm test -- tests/e2e/ragChat.test.ts
npm test -- tests/unit/providerOnboarding.test.ts
npm test -- tests/unit/modelProvider.test.ts
npm test -- tests/unit/queryRetrieval.test.ts
npm test -- tests/unit/vectorSearchIndex.test.ts
```

## Production Gates

Code-level GO does not equal physical production GO. Before deploying for a real company, prove:

- durable shared PostgreSQL or equivalent HA store is live
- provider secrets are stored in an approved secrets system
- internal service-to-service mTLS/PKI is enabled
- firewall/egress policy prevents unauthorized outbound data flow
- provider/model gateway is reachable only through approved internal paths
- backup, restore, failover, and recovery drills pass
- concurrent-user load tests pass for the target company size

## Developer Rule

Do not bypass BFF, PDP, RetrievalService, Orchestrator, or Model Gateway to call a provider directly. The provider key is a server-side secret, model choice is a catalog reference, and RAG context disclosure is governed live at request time.