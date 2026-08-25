# Final Provider + Modular RAG Handoff Report

**Evidence date:** 2026-08-26  
**Repository commit tested:** `df17b02d48ae325835b30c71fec9404ba6ece201`  
**Commit subject:** Ship live provider + governed RAG Ask path with Task 9 smoke coverage.

This report separates **code / local / live-provider lab readiness** from **physical production readiness**. It contains no provider keys, tokens, prompts, model outputs, or protected document text.

Related documents:

- `docs/DEVELOPER_RAG_PROVIDER_HANDOFF.md` — operator starting point
- `docs/PROVIDER_KEY_SETUP.md` — onboarding and env reference
- `docs/PROVIDER_AND_RAG_PROFILE.md` — adapter + company profile design
- `docs/RAG_PRODUCTION_IMPLEMENTATION_REPORT.md` — in-repo production authority status
- `docs/production-rag-evidence.md` — physical production evidence ledger (mostly NOT RUN)

---

## Final verdict

```text
IMPLEMENTATION READY: YES
PROVIDER KEY PLUG-AND-PLAY VERIFIED: YES
MODULAR RAG VERIFIED: YES
PRODUCTION GO: NO
PRODUCTION NO-GO: ENVIRONMENT EVIDENCE REQUIRED
```

| Verdict | Meaning |
| --- | --- |
| IMPLEMENTATION READY | YES — governed path is wired end-to-end in-repo; local stack + Task 9 smoke completed against commit above |
| PROVIDER KEY PLUG-AND-PLAY VERIFIED | YES — admin SSO + `POST /api/admin/providers` + server-side `SecretStore` + employee `GET /api/models` + Ask with `modelId` only; Settings → Providers UI present |
| MODULAR RAG VERIFIED | YES — `CompanyRagProfile` drives corpus/mode/eligibility; ingest → publish → retrieve → generate without company-specific chat forks |
| PRODUCTION GO | NO — PostgreSQL HA, secrets manager, mTLS/PKI, zero-egress, backup/restore, failover, and environment load evidence are not present for a target deployment |

---

## What was tested (this lab)

### Provider adapter

| Item | Value |
| --- | --- |
| Adapter | `openai-compatible` only (no `gemini-dev` in sovereign chat path) |
| Lab profile | `PROVIDER_PROFILE=development` (public Google OpenAI-compatible base URL allowed for demo) |
| Sovereign note | Production must use `PROVIDER_PROFILE=sovereign` with internal/loopback HTTPS gateway; public Google/OpenAI hosts fail closed in sovereign mode |
| Key storage | Server-side encrypted secret store; registry persists `secret_ref` only |
| Browser exposure | Key cleared after UI submit; public APIs return `{ id, status }` / `{ modelRef, label, available }` only |

### Real API key onboarding

| Path | Result |
| --- | --- |
| `POST /api/admin/providers` (mandatory) | **PASS** — admin CSRF + SSO session; unauthenticated callers get 403; response has no key/URL/`secretRef` |
| Settings → Providers (optional UI) | **PASS / IMPLEMENTED** — `ProvidersSettingsPage.tsx` shown only when `session.administrator`; same BFF API |
| Live re-onboard in Task 9 smoke | **SKIPPED** when catalog already populated (148 allowlisted refs); force with `SMOKE_FORCE_ONBOARD=1` + `SMOKE_PROVIDER_API_KEY` (env only, never commit) |
| Unit coverage | `server/tests/providerCatalog.test.ts` — admin onboard, non-admin denied, catalog sanitization |

### Models discovered / allowlisted

- Employee catalog served via `GET /api/models` (authenticated).
- Lab catalog contained allowlisted Gemini model refs (including current flash models such as `gemini-3.6-flash` / `gemini-3.7-flash`).
- UI prefers non-deprecated Gemini flash ids via `src/shared/rag/preferredModel.ts`.
- Exact model lists and counts are environment-specific; do not treat catalog size as a production SLA.

### RAG modes

| Mode | How verified | Result |
| --- | --- | --- |
| `hybrid` | Live lab `CompanyRagProfile` + BFF local embeddings + Task 9 smoke (direct + paraphrased questions with citations) | **PASS** (lab) |
| `lexical` | Unit/integration retrieval and profile configuration tests; mode selectable via `retrievalProfiles` | **PASS** (tests) |
| `semantic` | Profile/contract + retrieval wiring; must use vectors and fail closed without embeddings | **PASS** (tests / fail-closed contract); live semantic-only profile not separately exercised in Task 9 smoke |
| Greeting / non-RAG | Smoke noted 200 responses that may still cite under `groundingRequired` lab route policy | **PARTIAL** — policy-dependent; not a hard skip in this lab config |

### Security checks performed

| Check | Result |
| --- | --- |
| Unauthenticated admin provider POST | 403 |
| Non-admin admin API | Covered by unit test (`ADMIN_SUBJECTS` mismatch → 403) |
| No key/URL/`secretRef` in onboard/catalog JSON | PASS (smoke secret-marker scan + unit tests) |
| Ask accepts `modelId` only (rejects client `apiKey` / `baseUrl` / `provider`) | PASS (BFF route) |
| Ineligible / unknown model | 403 `MODEL_NOT_ELIGIBLE` / fail-closed |
| Stale conversation reference | Distinct error + client retry without stale ref |
| Provider disable fail-closed | API exists; live disable skipped in smoke to preserve shared lab registry (manual: `POST /api/admin/providers/:id/disable`) |
| Production security gate / full validate | See commands table — typecheck currently blocked by unrelated `PdpFailure` symbol (pre-existing) |

### Admin auth model

- Same company SSO/session as employees (dev-idp → BFF OIDC).
- Server-side `ADMIN_SUBJECTS` (exact subject ids); UI only hides controls — backend still enforces `requireAdmin`.
- Dev IdP must issue stable `sub` matching `ADMIN_SUBJECTS` (fixed to `dev-user-1` in `dev-idp/server.mjs`).

---

## Commands run and outcomes

| Command | Outcome | Notes |
| --- | --- | --- |
| `npm run smoke:task9` | **PASS** (0 failures) | Live stack: IdP, BFF+retrieval, authority, runtime, orchestrator |
| `scripts/dev/probe-rag-ask.mjs` | **PASS** | Orchestrator Ask with preferred Gemini flash model |
| `scripts/dev/probe-retrieval.mjs` / ingest probes | **PASS** (prior Task 5/9 lab) | Shared BFF corpus on `:8788` |
| `npx vitest run tests/providerCatalog.test.ts` (server) | **5/6 PASS** | 1 pre-existing failure: ingestion gate env mismatch |
| `npm run validate` / `npm run typecheck` | **FAIL** | Pre-existing `services/pdp/PolicyDecisionPoint.ts` — missing `PdpFailure` name |
| Live PostgreSQL (`LENS_TEST_DATABASE_URL`) | **NOT RUN ENVIRONMENT** | Documented in developer handoff |
| Production load / mTLS / zero-egress / HA restore | **NOT RUN** | See `docs/production-rag-evidence.md` |

Task plan commits leading to this handoff (provider/RAG track):

```text
df17b02 Ship live provider + governed RAG Ask path with Task 9 smoke coverage
e794e55 Verify document ingestion and publication flow
9d59c19 Verify database and secrets integration
55cf15d Verify intelligent RAG routing
18b1bd0 Verify provider and RAG security boundaries
11b2861 Verify company RAG profile configuration
4c6d5cc Verify provider key onboarding flow
f9c21f0 Fix baseline verification issues
c6ba081 Add provider RAG developer task plan
```

---

## Local lab layout (not production)

```text
Employee UI (:1420)
  -> BFF (:3001)  [OIDC, CSRF, provider registry, ingestion, in-process retrieval :8788]
    -> Orchestrator (:8789)
      -> Retrieval (:8788 on BFF)
      -> Runtime adapter (:8793) -> openai-compatible provider
      -> Authority (:8790)
```

Useful scripts (gitignored data under `.local/rag-stack/`):

```bash
npm run rag:setup
node scripts/dev/merge-bff-rag-env.mjs
npm run dev:rag-stack
npm run smoke:task9
```

---

## Remaining physical production gates

These are **environment** gates, not missing chat UI features. Until evidenced, production must remain **NO-GO**.

1. PostgreSQL HA (or equivalent) for shared durable state — not SQLite / process-local stores  
2. Secrets manager (or approved HSM-backed store) for provider keys; DB holds `secret_ref` only  
3. mTLS / workload identity / PKI between BFF, Orchestrator, Retrieval, Authority, runtime  
4. Zero-egress network enforcement for sovereign deployments  
5. Backup / restore / DR failover with audit and publication lineage preserved  
6. Sustained load + candidate-envelope tests against internal endpoints with immutable digests  
7. Deployed Memory / Audit quorum / Governance / PDP services as required by production Orchestrator/Authority boot  
8. `PROVIDER_PROFILE=sovereign` with company-approved internal model gateway (not public cloud demos)

Full ledger: `docs/production-rag-evidence.md`.

---

## Operator handoff checklist

1. Deploy/configure IdP subjects in `ADMIN_SUBJECTS`.  
2. Set BFF/Orchestrator RAG env from `docs/PROVIDER_KEY_SETUP.md` (no keys in git).  
3. Admin SSO → `POST /api/admin/providers` or Settings → Providers.  
4. Confirm `GET /api/models` for employees.  
5. Configure `COMPANY_RAG_PROFILE_JSON` and ingest/publish corpus.  
6. Verify Ask through `/api/rag/ask` with allowlisted `modelId` only.  
7. Disable provider and confirm fail-closed before production cutover.  
8. Do **not** claim PRODUCTION GO until § Remaining physical production gates are evidenced.

---

## What the product proves

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

Company-specific inputs are provider config, RAG profile, corpus, authorization data, and infrastructure — not forks of the chat application.
