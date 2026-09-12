# CURSOR Service Packages — Redundancy Packet (Worker C)

**Branch:** `cursor/redundancy-service-packages`  
**Worktree:** `/Users/rameelmalik/Documents/Lens/lens-wt-service-packages`  
**Date:** 2026-09-12  
**Scope:** `server/`, `orchestrator-service/`, `authority-service/`, `runtime-adapter-sidecar/`, `retrieval-service/` (package boundaries only; no `services/*` edits)

---

## Summary

| Class | Count | Lines removable (implemented) |
|---|---:|---:|
| `dead` | 0 | 0 |
| `duplicate` | 1 | ~151 (lockfile + package.json) |
| `convoluted` | 1 | 3 |
| `keep` | 12 | — |
| **Escalate (proposal only)** | 4 | — |

**Implemented net diffstat:** 3 files, **+9 / −154** lines.

**Protected-path diffstat:** empty (verified).

---

## Gates

| Gate | Before | After |
|---|---|---|
| `npm run typecheck; echo $?` | 0 | 0 |
| `npm run build` | 0 | 0 |
| `npm test` (repo root) | 10 failed (baseline) | 10 failed (same set) |
| `npm test --prefix orchestrator-service` | — | 208/208 pass |
| Protected paths touched | — | none |

### Failing tests (before = after, baseline)

- `tests/e2e/ragChat.test.ts` ×8 — `DEPENDENCY_UNAVAILABLE` / 503 vs expected (known-red)
- `tests/unit/bffRagUiApp.test.tsx` ×2 — `s.canGoBack is not a function` (known-red)

No new failures introduced by this branch.

---

## Patterns applied

| Source | Why | Landing |
|---|---|---|
| [12-Factor App — Config](https://12factor.net/config) | Parse env once at the process boundary; downstream code reads typed config, not re-parses the same discriminator. | `orchestrator-service/src/main.ts`: reuse `authorityProfile` instead of three extra `parseAuthorityProfile()` calls in `main()`. |
| npm workspace hoisting | Runtime deps required by shared `services/` code should live at the workspace root when resolution starts from `services/storage/pgPool.ts` via `createRequire`. | Removed duplicate `pg` from `runtime-adapter-sidecar/package.json`; production PostgreSQL still resolves via `lens-desktop` → root `pg`. |
| Fail-closed startup ordering (Lens invariant) | Production misconfiguration must fail at the earliest authoritative check with the intended error — not a later, unrelated gate. | **Kept** early MCP `:memory:` guard in `main()` (see finding C-2 note). |

---

## Findings — implemented

### C-1 · Duplicate `pg` in runtime-adapter-sidecar

**Path:** `runtime-adapter-sidecar/package.json`, `runtime-adapter-sidecar/package-lock.json`  
**Class:** `duplicate`

| Verification | Evidence |
|---|---|
| Static | No `import 'pg'` / `require('pg')` in `runtime-adapter-sidecar/src/**`. PostgreSQL access is via `../../services/storage/pgPool` → `createRequire(import.meta.url)("pg")` from `services/storage/`. |
| Dynamic | `PostgresPool.connect()` dynamically requires `pg` at runtime; resolution walks to root `node_modules` (monorepo). |
| Tests | `tests/unit/pgPool.test.ts` exercises `PostgresPool`/`SqlitePgCompatPool`; sidecar tests (`runtime-adapter-sidecar/tests/*.test.ts`) pass with pg only via `lens-desktop`. |
| Blast radius | After removal: `npm ls pg` in sidecar shows `lens-desktop → pg@8.23.0`. No sidecar source changes. |

**Change:** Remove direct `pg` dependency; keep `lens-desktop: file:..`.

---

### C-2 · Repeated `parseAuthorityProfile()` in orchestrator `main()`

**Path:** `orchestrator-service/src/main.ts` (~621–659)  
**Class:** `convoluted`

| Verification | Evidence |
|---|---|
| Static | `authorityProfile` already bound at line 569; three later calls re-parsed the same field. |
| Dynamic | `ORCHESTRATOR_AUTHORITY_PROFILE` is a plain env string — no string-dispatch registration. |
| Tests | `orchestrator-service/tests/mainProductionStartup.test.ts`, `m6cMcpProdWiring.test.ts`, `productionAuthorities.test.ts` — all pass after reuse. |
| Blast radius | Same throws, same branches; only eliminates redundant function calls. |

**Change:** Replace three `parseAuthorityProfile(env.ORCHESTRATOR_AUTHORITY_PROFILE)` calls with `authorityProfile`.

**Note:** An attempted removal of the **early** MCP `:memory:` production guard in `main()` was **reverted** — it changed startup error ordering and broke `mcp.prod-wiring-memory-registry-refused-in-production` (fail-closed ordering is intentional).

---

## Findings — escalate (proposal only, not implemented)

### E-1 · Orchestrator `loadEnv()` manual mapping (~88 keys)

**Path:** `orchestrator-service/src/main.ts` — `OrchestratorServiceEnv` + `loadEnv()`  
**Class:** `convoluted` (proposal)

Large interface + 1:1 `process.env.LENS_*` mapping. Advisor constraint: **do not delete keys that look unread** — many exist for fail-closed production paths, dev facts, and hot-reload. A helper/schema rewrite is only safe if behavior-identical and no key is dropped. Defer to a dedicated module after design review.

---

### E-2 · Server OIDC schema keys with no readers

**Path:** `server/src/config/index.ts` — `OIDC_REVOCATION_ENDPOINT`, `OIDC_USERINFO_ENDPOINT`, `OIDC_JWKS_ENDPOINT`, `OIDC_ALLOWED_ISSUERS`  
**Class:** `dead` (schema-only)

| Verification | Evidence |
|---|---|
| Static | Grep across `server/` — keys appear only in `envSchema`, not in `authService.ts`, `oidcClient.ts`, or routes. |
| Dynamic | No route/IPC registration; OIDC discovery uses issuer metadata, not these overrides (except `OIDC_TOKEN_INTROSPECTION_ENDPOINT` which **is** read). |
| Tests | No tests assert these keys. |
| Blast radius | Removing from schema changes validation behavior for deployers who set them — **proposal only**. |

---

### E-3 · Protected orchestrator agent wiring

**Path:** `orchestrator-service/src/{agentHarness,agentPdpReplica,agentDevFacts}.ts`  
**Class:** `keep` / protected

Not edited. Any convolution or duplication involving harness/PDP replica belongs in agent-integration design review, not this pass.

---

### E-4 · `retrieval-service/` vs `services/retrieval/`

**Class:** `keep`

`retrieval-service/` is the HTTP deployment wrapper (`main.ts`, `http.ts`, `adapters.ts`) over the protected `services/retrieval/` library. Not a duplicate — do not merge or delete either.

---

## `keep` list (verified live)

| Item | Why kept |
|---|---|
| All `server/package.json` deps (`cookie-parser`, `dotenv`, `express`, `jose`, `zod`) | Imported in `server/src/**` and tests. |
| `lens-desktop: file:..` in service package.json files | Monorepo link for `../../services/**` imports and hoisted transitive deps (incl. dynamic `pg`). |
| Every `OrchestratorServiceEnv` / `loadEnv()` key | Fail-closed production, dev facts, route-policy hot-reload, MCP, authorities — advisor: do not prune. |
| `PORT`/`HOST` `??` fallbacks in `main()` after `loadEnv()` | `main(env)` accepts injected partial env in tests without re-running `loadEnv()`. |
| Early MCP production `:memory:` check in `main()` | Preserves startup error ordering (`m6cMcpProdWiring` test). |
| Per-package `dev`/`build`/`test` scripts | Referenced from root `package.json` (`dev:orchestrator`, `test:orchestrator-service`, etc.). |
| `server/scripts/tsx-dev.mjs` | Used by `server/package.json` `dev` and `scripts/dev/desktop-stack.mjs`. |
| `authority-service/`, `retrieval-service/` package.json (no extra runtime deps) | Correct — code imports from `../../services/**` via monorepo TS paths. |
| Root `pg` dependency | Required by `services/storage/pgPool.ts` dynamic require for production PostgreSQL. |
| Identical vitest stubs per service | Minimal; each package runs isolated `vitest run` via `--prefix`. |

---

## Diffstat (implemented)

```
 orchestrator-service/src/main.ts          |   6 +-
 runtime-adapter-sidecar/package-lock.json | 154 +-----------------------------
 runtime-adapter-sidecar/package.json      |   3 +-
 3 files changed, 9 insertions(+), 154 deletions(-)
```

**Protected-path diffstat:** empty.

---

## Commands run

```bash
npm install --prefer-offline          # worktree root
npm install --prefer-offline          # server/ (for e2e harness deps)
npm run typecheck; echo $?            # → 0
npm test; echo $?                     # → 1, 10 failures (baseline)
npm run build                         # → 0
npm test --prefix orchestrator-service  # → 208/208
npm test --prefix runtime-adapter-sidecar # → 24/25 (1 pre-existing bindLease failure, unchanged by this diff)
git diff --stat -- services/pdp ...   # → empty
```
