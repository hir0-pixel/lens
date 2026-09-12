# CURSOR tooling PACKET — Worker D

**Branch:** `cursor/redundancy-tooling`  
**Date:** 2026-09-12  
**Scope:** `scripts/`, `libs/` (read-only audit), `platform/` (read-only audit), root configs (read-only audit), root `package.json` (read-only audit per advisor — no dep/script edits on this branch).

---

## Summary

| Class | Count | Lines removed (this branch) |
|---|---:|---:|
| `dead` | 1 | 116 |
| `convoluted` | 1 (fixed) | 0 net (4 added, 1 removed) |
| `duplicate` | 0 applied | 0 |
| `ide-leftover` | 0 | 0 |
| `keep` | 12 | — |
| **Escalations (proposal only)** | 6 | — |

**Total diffstat (implemented):** 2 files changed, 4 insertions(+), 117 deletions(−)  
**Protected-path diffstat:** empty

---

## Gates

| Gate | Before | After |
|---|---|---|
| `npm run typecheck; echo $?` | 0 | 0 |
| `npm run build; echo $?` | 0 | 0 |
| `npm test` failing set | 10 (baseline) | 10 (no new failures) |

**Before/after failing tests (unchanged baseline):**

- `tests/e2e/ragChat.test.ts` ×8
- `tests/unit/bffRagUiApp.test.tsx` ×2

---

## Implemented findings

### T-1 — `scripts/dev/probe-retrieval-inprocess.mjs` (`dead`)

**Why:** Pre–BFF-retrieval lab probe that wired `ProductionRetrievalWiring` in-process. Current lab path uses BFF `:8788` (`probe-retrieval.mjs`, `rag-stack.mjs`, `rag-stack-setup.mjs` comments). Zero references anywhere after file removal.

| Verification | Evidence |
|---|---|
| Static | `rg probe-retrieval-inprocess` → 0 hits repo-wide; not in `package.json`, docs, or CI |
| Dynamic | CLI-only `.mjs`; no npm script, no string registration |
| Tests | No test imports or subprocess spawn |
| Blast radius | None; `probe-retrieval.mjs` + `probe-ingestion.mjs` remain for lab debugging |

**Action:** Deleted (116 lines).

---

### T-2 — `scripts/dev/list-providers.mjs` default path (`convoluted`)

**Why:** Default sqlite path was a hard-coded Windows developer path (`E:/Orchids/lens/...`), broken on any other machine.

| Verification | Evidence |
|---|---|
| Static | 0 external refs; manual dev helper only |
| Dynamic | argv[2] override unchanged |
| Tests | None |
| Blast radius | Default-only when run with no args; explicit path arg behaviour unchanged |

**Action:** Default → `resolve(root, ".local/rag-stack/data/providers.sqlite")` (matches `rag-stack-setup.mjs` layout).

---

## Patterns applied

| Source | Why | Landing |
|---|---|---|
| [Tailwind v4 upgrade guide](https://tailwindcss.com/docs/upgrade-guide) — vendor prefixing built into v4; PostCSS/autoprefixer optional with `@tailwindcss/vite` | Repo already uses `@tailwindcss/vite` + `@import "tailwindcss"` in `src/index.css` | **Not applied** — root dep removal deferred (advisor: whole-repo grep + one owner for `package.json`) |
| Audit doc four-way verification (`11-REDUNDANCY-AUDIT.md`) | Every deletion must prove unreachable | `probe-retrieval-inprocess.mjs` deletion |
| Ponytail — deletion over addition | Avoid new shared `env-utils.mjs` without proof | Env-parser duplication left escalated |

---

## `keep` list (verified live)

| Item | Reason |
|---|---|
| `libs/rag-contracts`, `libs/generated-clients` | Generated from `scripts/contracts/*`; imported across orchestrator, retrieval, tests |
| `libs/security-envelope`, `libs/testkit` | Used by contract-probe integration tests |
| Root `pg` + `@types/pg` | `services/storage/pgPool.ts` (in root `tsconfig` include); `tests/unit/pgPool.test.ts` |
| Root `autoprefixer`, `postcss`, `@tailwindcss/cli` | Not removed — need dedicated root-`package.json` owner + full monorepo/CI grep per advisor |
| `scripts/contracts/*` | Generates protected `contracts/**`; must not touch |
| `platform/*.json` sovereignty baselines | Unchanged |
| Per-package `vitest.config.ts` / `tsconfig.json` | Package isolation; merge only if emit/test boundaries unchanged |
| `scripts/dev/probe-*.mjs` (except T-1) | Manual lab probes; 0 npm refs but still useful; not proven dead |
| `~$*` gitignore | Already present in `.gitignore`; no `~$README.md` in tree |

---

## Escalations (proposal only — not implemented)

1. **Root devDeps `autoprefixer`, `postcss`, `@tailwindcss/cli`** — Likely unused with `@tailwindcss/vite`, but require whole-repo import/config/CI grep before removal (Worker D defers to root `package.json` owner).

2. **Duplicate npm script aliases** — `test:m06-rag`/`test:m06-retrieval`, `test:m07-serving`/`test:m07-registry`, etc. point at identical preflight files; `verify:m06`–`m09` and `platform/build/workspace.mjs` `verify()` run some twice. Safe to dedupe after alias audit across docs/CI.

3. **Duplicate env parsers** — `parseEnv` / `parseEnvFile` / `loadDotEnv` / `loadEnv` copied across ~6 `scripts/dev/*.mjs`. Consolidation needs a shared module (addition) — separate small module.

4. **`tailwind.config.js` vs Tailwind v4 CSS-first** — `src/index.css` uses v4 `@theme`; legacy JS config referenced only by `components.json` for shadcn CLI. Do not delete without shadcn workflow check.

5. **`clsx` / `tailwind-merge` in devDependencies** — Imported from `src/lib/utils.ts` at runtime; misclassified but outside Worker D edit scope.

6. **Manual `scripts/dev/` probes with 0 repo refs** — ~14 files (`start-service-dev.mjs`, `probe-runtime.mjs`, …). Classify individually; do not bulk-delete without four-way proof each.

---

## Advisor constraints honored

- No root `package.json` / `package-lock.json` changes on this commit.
- No `scripts/contracts/*`, `platform/*.json`, or protected service paths touched.
- No vitest/tsconfig merges.
- No sub-agents spawned.

---

## Diffstat

```
 scripts/dev/list-providers.mjs            |   5 +-
 scripts/dev/probe-retrieval-inprocess.mjs | 116 ------------------------------
 2 files changed, 4 insertions(+), 117 deletions(-)
```
