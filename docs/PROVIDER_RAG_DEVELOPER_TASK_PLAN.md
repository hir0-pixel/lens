# Provider Key + Modular RAG Developer Task Plan

This plan is for a developer taking over the current implementation without prior knowledge of the codebase. It is intentionally task-based and disjoint: complete one task, verify it, commit it, then move to the next.

## Current Baseline

The repository baseline already contains a governed provider/RAG pipeline. Do not redesign or reimplement it from scratch.

Core path:

```text
Employee UI
  -> BFF / API Gateway
  -> Orchestrator
  -> live authorization / PDP
  -> RetrievalService
  -> protected content store
  -> Model Gateway
  -> runtime/provider adapter
  -> approved model endpoint
```

The browser must never receive provider keys, provider secret refs, internal model endpoints, authorization manifests, trusted subject fields, or index-generation controls.

## Non-Negotiable Rules

- Provider/API keys are entered only through admin setup and stored server-side.
- Employees select `modelRef`/`modelId` only.
- RAG behavior is controlled by `CompanyRagProfile` and ingestion, not company-specific code branches.
- `semantic` and `hybrid` RAG must use vectors and fail closed if vectors/embedding backend are unavailable.
- Retrieval must never disclose protected text before live authorization.
- No direct provider calls from UI or production chat code.
- No silent fallback to cloud providers or development adapters in sovereign mode.
- Code-level readiness is separate from physical production readiness.

## Read First

- `docs/DEVELOPER_RAG_PROVIDER_HANDOFF.md`
- `docs/PROVIDER_KEY_SETUP.md`
- `docs/PROVIDER_AND_RAG_PROFILE.md`
- `docs/RAG_PRODUCTION_IMPLEMENTATION_REPORT.md`
- `docs/production-rag-evidence.md`
- `services/model-provider/`
- `services/provider-registry/`
- `services/rag-profile/`
- `services/retrieval/`
- `services/ingestion/`
- `server/src/routes/providers.ts`
- `server/src/routes/api.ts`
- `orchestrator-service/src/`

## Working Method

For every task:

1. Pull latest `main`.
2. Check `git status --short`.
3. Make the smallest necessary change.
4. Add or update focused tests first when behavior changes.
5. Run the listed verification commands.
6. Write the task verdict in a short note or PR description.
7. Commit only that task with the suggested commit message.

Do not combine unrelated tasks in one commit.

---

## Task 1: Baseline Verification

Goal: Confirm the committed implementation is locally healthy before using a real provider key.

Likely files involved: none unless a real failure is found.

Verify:

- repo starts from latest `main`
- no unexpected untracked secrets or local databases are staged
- generated contracts are in sync
- local tests pass

Commands:

```bash
git pull origin main
git status --short
npm run validate
npm run typecheck
npm run lint
npm test
```

Definition of Done:

- all commands pass, or warnings are documented as pre-existing and non-blocking
- `server/.env`, `server/providers.sqlite`, `node_modules`, `dist`, and local secret files are not staged

GO/NO-GO:

- GO: baseline commands pass and no secrets/local artifacts are staged
- NO-GO: typecheck, contract, security, or core tests fail

Commit message if changes are required:

```text
Fix baseline verification issues
```

---

## Task 2: API Key Plug-And-Play Onboarding

Goal: Prove an admin can enter a provider/internal gateway API key once and employees can use discovered models without code changes.

Likely files involved:

- `server/src/routes/providers.ts`
- `server/src/routes/api.ts`
- `services/provider-registry/`
- `services/secrets/`
- `services/model-provider/`
- `src/features/settings/sections/ProvidersSettingsPage.tsx`
- `src/stores/modelCatalogStore.ts`
- `src/shared/bff-auth/client.ts`
- `docs/PROVIDER_KEY_SETUP.md`

Verify or implement:

- Settings -> Providers lets an admin submit provider id, base URL, API key, adapter type, and model allowlist
- API key goes only to BFF/admin endpoint
- BFF stores provider key server-side and persists only `secret_ref`/safe metadata
- BFF discovers provider models through provider model-list endpoint
- allowlisted models appear through `GET /api/models`
- employees never see raw provider key, secret ref, provider base URL, or internal runtime config

Definition of Done:

- admin can onboard a real test provider/internal OpenAI-compatible gateway
- `GET /api/models` returns allowed model refs
- UI model selector displays them
- browser devtools/network/localStorage/client bundle contain no raw key
- server logs redact key material

Commands:

```bash
npm test -- tests/unit/providerOnboarding.test.ts
npm test -- tests/unit/modelProvider.test.ts
npm test -- tests/unit/bffModelCatalogClient.test.ts
npm test --prefix server
npm run security:production
npm run validate
```

GO/NO-GO:

- GO: key entered once -> models discovered -> allowlisted models visible in UI -> no key leakage
- NO-GO: key appears in frontend, logs, localStorage, chat request payloads, or public API responses

Commit message:

```text
Verify provider key onboarding flow
```

---

## Task 3: UI Model Selection

Goal: Prove employees can select any allowlisted model from the chat UI without affecting RAG.

Likely files involved:

- `src/components/ai/AgentChatComposer.tsx`
- `src/stores/modelCatalogStore.ts`
- `src/stores/sessionStore.ts`
- `src/shared/bff-auth/client.ts`
- `server/src/rag/service.ts`
- `server/src/rag/orchestratorClient.ts`

Verify or implement:

- UI loads models from `GET /api/models`
- employee selection stores a model reference, not provider details
- chat submit sends only `modelId`/`modelRef`
- changing selected model does not alter corpus, auth, retrieval, or profile decisions
- unknown/disabled model refs fail closed

Definition of Done:

- two or more allowed models can be selected and used through the same governed path
- model switching does not bypass RAG or authorization
- unavailable model state is shown without leaking internals

Commands:

```bash
npm test -- tests/unit/bffRagUiApp.test.tsx
npm test -- tests/unit/bffRagUiClient.test.ts
npm test -- tests/unit/bffModelCatalogClient.test.ts
npm test --prefix server
npm run validate
```

GO/NO-GO:

- GO: employees can switch models, chat still routes through BFF/Orchestrator/RAG
- NO-GO: UI sends provider endpoint/key, bypasses BFF, or can select unapproved models

Commit message:

```text
Verify UI model selection flow
```

---

## Task 4: Company RAG Profile Configuration

Goal: Prove RAG can be changed per company through configuration, not code edits.

Likely files involved:

- `services/rag-profile/companyRagProfile.ts`
- `services/rag-profile/companyRagProfile.test.ts`
- `services/retrieval/ProductionRetrievalWiring.ts`
- `orchestrator-service/src/groundingPolicy.ts`
- `orchestrator-service/src/modelGovernance.ts`
- `docs/PROVIDER_AND_RAG_PROFILE.md`

Verify or implement:

- `CompanyRagProfile` supports corpus refs, retrieval mode, grounding policy, limits, eligible model patterns, version, and digest
- BFF and Orchestrator use the same profile version/digest
- changing profile changes RAG behavior without editing chat/provider code
- stale or mismatched profile/version/digest fails closed

Definition of Done:

- lexical, semantic, and hybrid mode profiles can be configured
- model eligibility is enforced
- profile mismatch produces explicit failure, not silent drift

Commands:

```bash
npm test -- services/rag-profile/companyRagProfile.test.ts
npm test -- tests/unit/queryRetrieval.test.ts
npm test -- tests/e2e/ragChat.test.ts
npm run test:orchestrator-service
npm run validate
```

GO/NO-GO:

- GO: per-company RAG profile is config-driven and versioned
- NO-GO: company behavior is hardcoded or profile mismatch is ignored

Commit message:

```text
Verify company RAG profile configuration
```

---

## Task 5: Document Ingestion, Publication, And Updates

Goal: Prove company documents can be ingested, published, updated, withdrawn, and retrieved safely.

Likely files involved:

- `server/src/routes/ingestion.ts`
- `services/ingestion/`
- `services/retrieval/publicationStore.ts`
- `services/retrieval/PublicationAuthority.ts`
- `services/retrieval/LexicalSearchIndex.ts`
- `services/retrieval/VectorSearchIndex.ts`
- `services/storage/`

Verify or implement:

- admin-only ingestion endpoint works when explicitly enabled
- chunk text is embedded and protected content is stored in sovereign content store
- index stores searchable refs/hints/vectors, not unauthorized text disclosure paths
- publication generation cutover is atomic
- withdrawn/replaced generations cannot be returned by lexical, semantic, or hybrid retrieval

Definition of Done:

- a test document can be ingested and retrieved after publish
- an updated document replaces old searchable content
- a withdrawn document is not returned
- unauthorized user gets no text or citations

Commands:

```bash
npm test -- tests/unit/ingestionContentRetrieval.test.ts
npm test -- tests/unit/ingestionPortAdapters.test.ts
npm test -- tests/unit/track3Publication.test.ts
npm test -- tests/unit/vectorSearchIndex.test.ts
npm test -- tests/e2e/ragChat.test.ts
npm run verify:m05
npm run validate
```

GO/NO-GO:

- GO: ingest/update/withdraw flow works and respects authorization
- NO-GO: stale, partial, mixed-generation, or unauthorized content can be returned

Commit message:

```text
Verify document ingestion and publication flow
```

---

## Task 6: Intelligent RAG Routing

Goal: Prove the app does not blindly use RAG for every message, but uses RAG when grounding is needed.

Likely files involved:

- `orchestrator-service/src/router.ts`
- `orchestrator-service/src/groundingPolicy.ts`
- `orchestrator-service/src/service.ts`
- `services/retrieval/RetrievalService.ts`
- `tests/e2e/ragChat.test.ts`

Verify or implement:

- greetings and acknowledgements such as `hello`, `okay`, `yes` do not force retrieval
- company policy/manual/document questions use retrieval when profile requires grounding
- semantic paraphrases retrieve relevant docs without relying only on keyword overlap
- hybrid combines lexical and vector candidates with deterministic bounded ranking
- no-context, all-denied, and no-match responses do not reveal document existence

Definition of Done:

- routing tests cover non-RAG chat, grounded RAG, semantic paraphrase, hybrid ranking, and no-context behavior
- model receives only authorized context
- no hardcoded keyword-only behavior is required for normal RAG use

Commands:

```bash
npm test -- orchestrator-service/tests/router.test.ts
npm test -- orchestrator-service/tests/groundingPolicy.test.ts
npm test -- tests/unit/queryRetrieval.test.ts
npm test -- tests/unit/vectorSearchIndex.test.ts
npm test -- tests/e2e/ragChat.test.ts
npm run validate
```

GO/NO-GO:

- GO: simple chat skips RAG, document questions use RAG, semantic/hybrid behave correctly
- NO-GO: every prompt triggers RAG, semantic/hybrid silently degrade to lexical, or RAG reveals document existence

Commit message:

```text
Verify intelligent RAG routing
```

---

## Task 7: Security Boundary Verification

Goal: Prove an internal employee cannot exploit provider/RAG boundaries.

Likely files involved:

- `server/src/middleware/csrf.ts`
- `server/src/routes/api.ts`
- `server/src/routes/providers.ts`
- `server/src/security/`
- `services/security/`
- `services/pdp/`
- `services/governance/`
- `tests/security/`

Verify or implement:

- spoofed subject, role, provider endpoint, model endpoint, secret ref, authorization manifest, index generation, and corpus ref are rejected
- invalid/missing CSRF/session fails before Orchestrator is called
- unauthorized users receive no restricted text/citations
- logs and telemetry do not contain provider keys, cookies, tokens, prompts, outputs, or document text
- production config rejects dev/test providers and external fallback unless explicitly non-sovereign

Definition of Done:

- all security boundary tests pass
- no protected or secret material is visible in UI, logs, telemetry, or public API responses
- production mode fails closed on unsafe config

Commands:

```bash
npm run security:production
npm test -- tests/security
npm test -- tests/unit/logger.test.ts
npm test -- tests/unit/authorityReceipt.test.ts
npm test -- tests/unit/replayClaimStore.test.ts
npm test --prefix server
npm run validate
```

GO/NO-GO:

- GO: all trust-boundary attacks fail closed
- NO-GO: any protected content, key, token, or privileged field crosses into the browser or logs

Commit message:

```text
Verify provider and RAG security boundaries
```

---

## Task 8: Database And Secrets Integration Test

Goal: Prove the developer understands what lives in local files, PostgreSQL, and the secrets layer.

Likely files involved:

- `services/storage/pgPool.ts`
- `services/provider-registry/`
- `services/secrets/SecretStore.ts`
- `services/cost-authority/`
- `services/agent-run-authority/`
- `services/runtime-attempt/`
- `server/src/config/index.ts`
- `docs/DEVELOPER_RAG_PROVIDER_HANDOFF.md`

Verify or implement:

- local/demo mode can use SQLite/local files
- production mode refuses unsafe `:memory:`/process-local stores where shared durability is required
- PostgreSQL/equivalent stores shared service state, not browser data
- secrets manager/encrypted server-side store holds API keys; database stores only secret refs
- if a live PostgreSQL URL is available, run the integration path against it

Definition of Done:

- local mode and production config boundaries are documented and tested
- production config cannot accidentally run with throwaway local state
- real PostgreSQL test result is recorded as PASS, FAIL, or NOT RUN ENVIRONMENT

Commands:

```bash
npm test -- tests/unit/pgPool.test.ts
npm test -- tests/unit/productionConfigPersistence.test.ts
npm test -- tests/unit/SecretStore.test.ts
npm test -- tests/unit/sqliteCostAuthority.test.ts
npm test -- tests/unit/sqliteAgentRunAuthority.test.ts
npm run validate
```

GO/NO-GO:

- GO: local/demo storage is clearly separated from production shared storage
- NO-GO: production can start with unsafe process-local state or plaintext key persistence

Commit message:

```text
Verify database and secrets integration
```

---

## Task 9: Live Provider + RAG Smoke Test

Goal: Run the whole setup with one real approved provider/internal model gateway key.

Likely files involved:

- documentation only, unless a real bug is found
- `.env` files must remain untracked

Test procedure:

1. Configure admin subject and server environment.
2. Start required local services.
3. Onboard provider/internal gateway key through Settings -> Providers or `POST /api/admin/providers`.
4. Confirm models appear in UI.
5. Select a model.
6. Ingest a small test corpus with non-sensitive sample documents.
7. Ask:
   - a greeting: should skip RAG
   - a direct document question: should use RAG
   - a paraphrased semantic question: should retrieve relevant context
   - a question as unauthorized user: should disclose nothing
8. Rotate/disable provider and confirm disabled model cannot be used.

Definition of Done:

- live provider key works through admin onboarding
- models appear in UI
- chat works through the governed path
- RAG behavior matches profile
- disabling provider/model fails closed
- no real key or sensitive text is committed or logged

Commands:

```bash
git status --short
npm run validate
```

GO/NO-GO:

- GO: admin key -> model list -> UI selection -> RAG chat works with no key leakage
- NO-GO: provider key leaks, model catalog fails, RAG bypasses authorization, or chat calls provider directly

Commit message:

```text
Document live provider RAG smoke results
```

---

## Task 10: Final Handoff Report

Goal: Produce a concise final report that states what is ready and what still requires real infrastructure.

Likely files involved:

- `docs/rag-final-provider-handoff-report.md`
- `docs/production-rag-evidence.md`
- `docs/RAG_PRODUCTION_IMPLEMENTATION_REPORT.md`

Report must include:

- exact commit hash tested
- provider adapter used
- whether real API key onboarding passed
- models discovered and allowlisted, without printing secrets
- RAG modes tested: lexical, semantic, hybrid
- security checks performed
- commands run and pass/fail counts
- remaining physical production gates

Definition of Done:

- developer can hand the report to another engineer/operator
- report clearly separates code-level readiness from physical production readiness
- no secret values, prompts, outputs, or protected document text are included

Final verdict format:

```text
IMPLEMENTATION READY: YES/NO
PROVIDER KEY PLUG-AND-PLAY VERIFIED: YES/NO
MODULAR RAG VERIFIED: YES/NO
PRODUCTION GO: YES/NO
```

GO/NO-GO:

- IMPLEMENTATION READY GO: all code/local/live-provider tasks pass
- PRODUCTION GO: only if PostgreSQL HA/equivalent, secrets manager, mTLS/PKI, zero-egress, backup/restore, failover, and load tests are proven in the target environment
- Otherwise production verdict must be `PRODUCTION NO-GO: ENVIRONMENT EVIDENCE REQUIRED`

Commit message:

```text
Add final provider RAG handoff report
```

---

## What The Developer Is Actually Making

The developer is not making a new chatbot from scratch. They are proving and finishing this product behavior:

```text
Admin enters provider/internal gateway key once
  -> server stores key securely
  -> server discovers and allowlists models
  -> employee sees allowed models in chat UI
  -> employee selects modelRef
  -> chat request goes through governed RAG
  -> RAG uses company profile and current corpus
  -> model receives only authorized context
  -> output returns through audit/release path
```

The company-specific parts are provider configuration, RAG profile, document corpus, authorization data, and production infrastructure. The application code should stay modular and mostly unchanged between companies.
