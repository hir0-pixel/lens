# CURSOR · Governed Services Redundancy Packet

**Worker:** B · governed services  
**Branch:** `cursor/redundancy-governed-services`  
**Worktree:** `/Users/rameelmalik/Documents/Lens/lens-wt-governed-services`  
**Date:** 2026-09-12  
**Scope:** `services/` except protected paths. No edits to `orchestrator-service/`, `libs/`, `scripts/`, or root configs.

---

## Summary

| Class | Count | Lines removed |
|---|---:|---:|
| `dead` | 1 | 26 |
| `convoluted` (simplified) | 1 | 1 |
| `duplicate` | 0 implemented | 0 |
| `ide-leftover` | 0 | 0 |
| `keep` | 8 | — |
| **Escalations (proposal only)** | 5 | — |

**Diffstat (implemented):** 3 files, +2 / −28 lines  
**Protected-path diffstat:** empty ✓

---

## Gates

| Gate | Before | After |
|---|---|---|
| `npm run typecheck; echo $?` | 0 | 0 |
| `npm run build; echo $?` | 0 | 0 |
| `npm test` | 2 baseline-red (`bffRagUiApp.test.tsx` ×2) + `ragChat.test.ts` suite blocked (missing `cookie-parser` in worktree install — pre-existing env gap, not introduced by this diff) | Same: 2 baseline-red unchanged; no new failures in executed suites |

**Baseline-red (unchanged):** `tests/unit/bffRagUiApp.test.tsx` ×2 (`s.canGoBack is not a function`).

---

## Patterns applied

| Source | Why it fits | Landing site |
|---|---|---|
| [Bounded Context](https://martinfowler.com/bliki/BoundedContext.html) (DDD) | Tool catalog shapes belong to different layers (runtime envelope, execution dispatch, MCP pin/approval); unifying them would collapse authority boundaries. | Escalation § ToolCatalogEntry — classify only, no shared type. |
| TypeScript interface declaration merging | Two `ModelEligibilityPort` blocks in one file merge to an identical type; one block is clearer with zero behaviour change. | `services/model-gateway/ModelGateway.ts` |

---

## Findings — implemented

### GS-1 · `CostController` — dead process-local ledger

**Path:** `services/cost-controller/CostController.ts` (deleted)  
**Class:** `dead`

| Verification | Evidence |
|---|---|
| **Static** | `rg cost-controller\|CostController\|BudgetError\|BudgetReservation` → zero imports outside the deleted file. Graph search returns only symbols inside `CostController.ts`. |
| **Dynamic** | No route, IPC, config key, or string dispatch references `CostController`. Only historical mentions in `docs/RAG_PRODUCTION_IMPLEMENTATION_REPORT.md`. |
| **Tests** | No test file imports or exercises `CostController`. `tests/unit/sqliteCostAuthority.test.ts` covers the real `SqliteCostAuthority` port instead. |
| **Blast radius** | `services/cost-authority/CostAuthority.ts` comment updated (removed stale path reference). No runtime wiring ever constructed `CostController`. |

**Change:** Delete file; reword comment in `CostAuthority.ts` to “process-local in-memory ledger” (no path reference).

---

### GS-2 · Duplicate `ModelEligibilityPort` interface blocks

**Path:** `services/model-gateway/ModelGateway.ts:9-12`  
**Class:** `convoluted`

| Verification | Evidence |
|---|---|
| **Static** | Two consecutive `export interface ModelEligibilityPort` declarations; TypeScript merges them. Single consumer: `ModelGateway` constructor at line 125. |
| **Dynamic** | N/A — compile-time type only. |
| **Tests** | `tests/integration/m07-serving.test.ts`, `m07-retry-idempotency.test.ts`, `m2-model-transport.test.ts` exercise `ModelGateway` with eligibility mocks; merged interface is structurally identical. |
| **Blast radius** | Zero — merged declaration produces the same type as declaration merging. |

**Change:** Collapse to one interface block with `resolve` + optional `resolveChat?`.

---

## Escalations — stop-and-ask (not implemented)

### ESC-1 · Three ToolCatalogEntry-shaped types — classify only

Three distinct catalog layers; **do not unify**, merge risk enums, or introduce shared aliases.

| Layer | Type | Location | Role |
|---|---|---|---|
| **Runtime** | `ToolCatalogEntry` | `services/agent-runtime/AgentRuntime.ts` | Envelope/catalog authority: `toolId`, digest fields (`targetProfileDigest`, `schemaDigest`, `dataFlowProfileDigest`), risk (`read` \| `reversible_write` \| `high_risk`), `idempotentReplay`. Registered at run construction; gates step reservation. |
| **Execution** | `ToolCatalogEntry` | `services/tool-execution/ToolExecutionService.ts` | Dispatch authority: `name`, `targetRef`, `action`, risk (`read` \| `write`), `externalCapable`. Consumed by `ToolExecutionService.execute`; **protected** `services/agent-integration/mcpTool.ts` maps into this shape via `mcpExecutionCatalogEntry`. |
| **MCP registry** | `McpToolRecord` (+ wire `McpToolDescriptor`) | `services/mcp-registry/McpRegistry.ts`, `wireProtocol.ts` | Admin pin/approval store: `serverId`, `toolId`, `schemaDigest`, `resultAuthorization`, `state`. Narrower than runtime/execution; no risk enum, no execution fields. |

**Bridge (protected):** `services/agent-integration/mcpTool.ts` owns `McpToolDescriptor` and explicit mappers `mcpRuntimeCatalogEntry` / `mcpExecutionCatalogEntry`. Reshaping `tool-execution.ToolCatalogEntry` would require coordinated protected changes — escalate.

**Reason to keep separate:** Each type is consumed by a different authority boundary (run envelope vs tool dispatch vs MCP approval pin). Unification would relocate fields across boundaries (G1–G7 violation risk).

---

### ESC-2 · Duplicate `canonicalJson` in `governanceBinding.ts`

**Path:** `services/agent-integration/governanceBinding.ts:68-86` (protected)  
**Class:** `duplicate`  
Local copy of `services/security/canonicalJson.ts`. Safe to replace with import, but touches protected `agent-integration/**` — proposal only.

---

### ESC-3 · Duplicate `sha256()` helpers in agent-integration

**Paths:** `services/agent-integration/corpusTool.ts:17`, `mcpTool.ts:59` (protected)  
**Class:** `duplicate`  
Identical one-liner; could move to shared helper, but protected — proposal only.

---

### ESC-4 · Duplicate `McpToolDescriptor` name across MCP packages

**Paths:** `services/mcp-registry/wireProtocol.ts` (wire list shape) vs `services/agent-integration/mcpTool.ts` (full approval descriptor) (both protected)  
**Class:** `duplicate`  
Same name, different fields — intentional anti-corruption at boundary per M6C review packet. Unification is a design change — stop-and-ask.

---

### ESC-5 · `ModelGateway.ts` length (~362 lines)

**Path:** `services/model-gateway/ModelGateway.ts`  
**Class:** `convoluted`  
Long but cohesive dispatch pipeline (eligibility → scheduler → attempt store → runtime). Extraction would be structural refactor with behaviour-review risk — defer.

---

## `keep` list

| Item | Reason |
|---|---|
| `services/security/*` (receipt, claim, assertion helpers) | Live imports from orchestrator-service, server, sidecar, tests — not dead despite appearing “helper-only”. |
| `services/session/SessionAuthority.ts` | Exercised by `tests/unit/m02Authorities.test.ts`; distinct from BFF `SessionContext`. |
| `services/governance/PdpGovernanceConsumerSimulator.ts` | Test-only but live in `tests/integration/m03-governance.test.ts`. |
| `services/orchestrator/FakeInferenceAdapter.ts` | Test harness export via `services/orchestrator/index.ts`. |
| `services/cache-control/RetrievalCacheControl.ts` | Test-covered (`m06Retrieval.test.ts`); production wiring deferred, not dead. |
| `services/internal-http/internalHttp.ts` + `internalServiceHttp.ts` | Complementary client vs server helpers; both have callers. |
| `libs/` vs `services/` type overlap (`rag-contracts`, `security-envelope`) | Intentional contract boundary — services own runtime, libs own published contracts. |
| `SessionContext` name in both `session/` and `product-bff/` | Different shapes, different bounded contexts — rename would be cross-package API change. |

---

## Protected-path diffstat

```
(empty — no edits under protected paths)
```

---

## Commit

```
Remove dead CostController; collapse ModelEligibilityPort

CostController was a superseded process-local ledger simulator with zero
callers. SqliteCostAuthority and network clients are the real port.
ModelEligibilityPort duplicate interface blocks merged with no type change.
```
