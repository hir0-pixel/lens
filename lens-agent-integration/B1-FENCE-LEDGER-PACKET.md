# B1 Review Packet — Shared fence ledger (F-S1, F-P3)

Branch: `codex/b1-fence-ledger`
Worktree: `/Users/rameelmalik/Documents/Lens/lens-wt-b1-fence-ledger`

## 1. Diffstat

```
 orchestrator-service/src/agentPdpReplica.ts  | 15 +++++++++++++++
 orchestrator-service/src/main.ts             | 19 +++++++++++++++----
 services/agent-integration/modelTransport.ts |  1 +
 services/pdp/FenceLedger.ts                  | 71 +++++++++++++++++++++++++++++++++++++++ (new)
 services/pdp/PolicyDecisionPoint.ts          | 16 +++++++++++++---
 tests/integration/m2-model-transport.test.ts |  1 +
 tests/unit/fenceLedger.test.ts               | 97 ++++++++++++++++++++++++++++++++++++++++ (new)
```

## 2. Protected-path diffstat

```
$ git diff --stat HEAD -- contracts/ services/secrets/
(empty)

$ git diff --stat HEAD -- services/agent-integration/
 services/agent-integration/modelTransport.ts | 1 +
 1 file changed, 1 insertion(+)
```

Authorized one-liner in `modelTransport.ts`:

```diff
   const forbidden = Object.keys(environment).find((name) =>
     name === "SECRET_STORE_KEY"
+    || name.endsWith("SECRET_STORE_KEY")
     || name === "CATALOG_WORKLOAD_TOKEN"
```

B1 exception paths touched as specified:

```
 services/pdp/FenceLedger.ts                  | 71 (new)
 services/pdp/PolicyDecisionPoint.ts          | 16 +++++++++++++---
 orchestrator-service/src/agentPdpReplica.ts  | 15 +++++++++++++++
 orchestrator-service/src/main.ts             | 19 +++++++++++++++----
```

## 3. Build summary

| Item | Landing |
|---|---|
| `FenceLedger` port (`consume(fenceId): boolean`) | `services/pdp/FenceLedger.ts` |
| Default in-process impl | `InMemoryFenceLedger` (Set semantics, default PDP constructor arg) |
| SQLite unique-key impl | `SqliteFenceLedger` (WAL, `fence_id PRIMARY KEY`) |
| Orchestrator wiring | `LENS_AGENT_FENCE_LEDGER_PATH` → `loadAgentFenceLedger` in `agentPdpReplica.ts`, called from `loadAgentPolicyReplica` in `main.ts` |
| Production `:memory:` refusal | `createAgentFenceLedger` + early guard in `main()` |

## 4. Hold evidence (real exit codes)

### `fence.replay-across-replicas-rejected`

```
$ npx vitest run tests/unit/fenceLedger.test.ts -t fence.replay-across-replicas-rejected --reporter=verbose; echo "exit: $?"
 ✓ tests/unit/fenceLedger.test.ts > FenceLedger > fence.replay-across-replicas-rejected
 Test Files  1 passed (1)
      Tests  1 passed (1)
exit: 0
```

Two `PolicyDecisionPoint` instances, separate `SqliteFenceLedger` connections on one shared file; first `consumeFence` succeeds, second throws `PdpError`; direct `ledger.consume(fenceId)` returns `false`.

### `fence.default-ledger-unchanged`

```
$ npx vitest run tests/unit/fenceLedger.test.ts -t fence.default-ledger-unchanged tests/unit/m03Pdp.test.ts --reporter=verbose; echo "exit: $?"
 ✓ tests/unit/fenceLedger.test.ts > FenceLedger > fence.default-ledger-unchanged
 ✓ tests/unit/m03Pdp.test.ts > M03 PDP > uses one current fact snapshot and issues a one-use revision-bound allow fence
 ✓ tests/unit/m03Pdp.test.ts > M03 PDP > rejects partial oversized batches before authorization
 ✓ tests/unit/m03Pdp.test.ts > M03 PDP > fails closed when the owner revision keeps changing
 ✓ tests/unit/m03Pdp.test.ts > M03 PDP > activates only immutable, reviewed policy evidence and writes an outbox record
 Test Files  2 passed (2)
      Tests  5 passed (5)
exit: 0
```

### `fence.memory-refused-in-production`

```
$ npx vitest run tests/unit/fenceLedger.test.ts -t fence.memory-refused-in-production --reporter=verbose; echo "exit: $?"
 ✓ tests/unit/fenceLedger.test.ts > FenceLedger > fence.memory-refused-in-production
 Test Files  1 passed (1)
      Tests  1 passed (1)
exit: 0
```

### `transport.no-secrets-in-env` (extended for `*SECRET_STORE_KEY`)

```
$ npx vitest run tests/integration/m2-model-transport.test.ts -t transport.no-secrets-in-env --reporter=verbose; echo "exit: $?"
 ✓ tests/integration/m2-model-transport.test.ts > M2a model transport > transport.no-secrets-in-env
 Test Files  1 passed (1)
      Tests  1 passed (1)
exit: 0
```

Now rejects `LENS_MCP_SECRET_STORE_KEY` via `endsWith("SECRET_STORE_KEY")`.

## 5. Gate commands

### Typecheck

```
$ npm run typecheck; echo "exit: $?"
exit: 0
```

### Root test suite (regression vs known-red)

```
$ npx vitest run; echo "exit: $?"
 Test Files  2 failed | 85 passed (87)
      Tests  2 failed | 438 passed (440)
exit: 1
```

Failures unchanged from baseline — pre-existing only:

- `tests/unit/bffRagUiApp.test.tsx` (2 tests: `s.canGoBack is not a function`)
- No new failures; +3 tests added (fence holds), net 440 vs prior 437 passing

### Orchestrator-service suite

```
$ cd orchestrator-service && npx vitest run; echo "exit: $?"
 Test Files  26 passed (26)
      Tests  208 passed (208)
exit: 0
```

## 6. Environment variable

**New:** `LENS_AGENT_FENCE_LEDGER_PATH` — SQLite path for cross-replica agent PDP fence consumption.

- Absent → `InMemoryFenceLedger` (single-replica dev/test, unchanged behavior)
- Set to durable path → `SqliteFenceLedger` shared across orchestrator replicas
- Set to `:memory:` with `LENS_ORCHESTRATOR_AUTHORITY_PROFILE=production` → startup throws

## 7. MCP credential resolution — deferred shape (>150 lines)

**Not implemented this run.** Current wiring (`main.ts` `loadMcpTools`) still constructs `EncryptedSqliteSecretStore` with `LENS_MCP_SECRET_STORE_KEY` in-process.

**Proposed follow-up shape (~180 lines):**

```
services/mcp-registry/McpSecretResolverPort.ts   (~25 lines)
  resolveCredential(serverId): Promise<{ credentialRef: string }>  // no raw secret bytes in orchestrator

orchestrator-service/src/mcpSecretResolverClient.ts   (~60 lines)
  HTTP client to a sibling secret-resolution service (mirrors CostAuthorityHttpClient pattern)
  env: LENS_MCP_SECRET_RESOLVER_URL + LENS_MCP_SECRET_RESOLVER_WORKLOAD_TOKEN

orchestrator-service/src/main.ts   (~40 lines)
  loadMcpTools: replace EncryptedSqliteSecretStore + KEY with resolver client
  orchestrator holds serverId/credentialRef only; broker calls resolver at dispatch

services/mcp-registry/McpCredentialBroker.ts   (~30 lines)
  accept McpSecretResolverPort instead of SecretStore; resolve ref → ephemeral credential handle

tests/unit/mcpSecretResolver.test.ts + orchestrator wiring test   (~25 lines)
```

This keeps the orchestrator process free of `*SECRET_STORE_KEY` env vars entirely (the one-liner guard added here is defense-in-depth until the resolver lands).

## 8. Invariants confirmed

- G1: Agent env guard extended; no new credential env vars added to harness path
- ADR-005-004: Fence replay across replicas now rejected via shared durable ledger
- Protected paths `contracts/**`, `services/secrets/**` untouched
- Default single-replica PDP behavior byte-identical (m03 suite green)
