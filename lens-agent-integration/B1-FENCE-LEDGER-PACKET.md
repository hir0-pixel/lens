# B1 Review Packet — Shared fence ledger (F-S1, F-P3)

Branch: `codex/b1-fence-ledger`
Worktree: `/Users/rameelmalik/Documents/Lens/lens-wt-b1-fence-ledger`

## 1. Diffstat

```
 orchestrator-service/src/agentPdpReplica.ts  | 15 +++++++++++++++
 orchestrator-service/src/main.ts             | 19 +++++++++++++++----
 services/pdp/FenceLedger.ts                  | 71 +++++++++++++++++++++++++++++++++++++++ (new)
 services/pdp/PolicyDecisionPoint.ts          | 16 +++++++++++++---
 tests/unit/fenceLedger.test.ts               | 97 ++++++++++++++++++++++++++++++++++++++++ (new)
```

## 2. Protected-path diffstat

```
$ git diff --stat HEAD~1 HEAD -- contracts/ services/secrets/ services/agent-integration/
(empty)
```

B1 exception paths touched as specified:

```
 services/pdp/FenceLedger.ts                  | 71 (new)
 services/pdp/PolicyDecisionPoint.ts          | 16 +++++++++++++---
 orchestrator-service/src/agentPdpReplica.ts  | 15 +++++++++++++++
 orchestrator-service/src/main.ts             | 19 +++++++++++++++----
```

**Not touched:** `services/agent-integration/**` (see §7 — `endsWith("SECRET_STORE_KEY")` reverted per advisor).

## 3. Build summary

| Item | Landing |
|---|---|
| `FenceLedger` port (`consume(fenceId): boolean`, sync) | `services/pdp/FenceLedger.ts` |
| Default in-process impl | `InMemoryFenceLedger` (Set semantics) |
| SQLite impl | `SqliteFenceLedger` — mirrors `SqliteClaimStore` (`DatabaseSync`, WAL, `busy_timeout`, INSERT + PRIMARY KEY, `changes === 1`); table `pdp_fence_consumptions`, not `authority_claims` |
| PDP injection | Last optional ctor arg after `nextFence` (default `InMemoryFenceLedger`); `createAgentPolicyReplica` passes `now` in 4th slot, `fenceLedger` in 6th |
| Orchestrator wiring | `LENS_AGENT_FENCE_LEDGER_PATH` → `loadAgentFenceLedger` in `agentPdpReplica.ts`, called from `loadAgentPolicyReplica` in `main.ts` (fence env slice only; `loadMcpTools` untouched) |
| Production `:memory:` refusal | `createAgentFenceLedger` + early guard in `main()` (same pattern as MCP registry) |

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

`m03Pdp.test.ts` unmodified — default ctor path unchanged.

### `fence.memory-refused-in-production`

```
$ npx vitest run tests/unit/fenceLedger.test.ts -t fence.memory-refused-in-production --reporter=verbose; echo "exit: $?"
 ✓ tests/unit/fenceLedger.test.ts > FenceLedger > fence.memory-refused-in-production
 Test Files  1 passed (1)
      Tests  1 passed (1)
exit: 0
```

### `transport.no-secrets-in-env` — **DEFERRED / ESCALATED**

**Not extended this run.** Advisor blocked shipping `endsWith("SECRET_STORE_KEY")` alone:

- `loadMcpTools` (M6c) still constructs `EncryptedSqliteSecretStore(env.MCP_SECRET_STORE_PATH, env.MCP_SECRET_STORE_KEY)` in the orchestrator process.
- Adding the predicate to `assertAgentEnvironment` would make `createProductionAgentHarness` throw whenever MCP is enabled, because the orchestrator env legitimately carries `LENS_MCP_SECRET_STORE_KEY` today.
- Fixing the hold requires moving MCP credential resolution out of the agent process first (see §6), not a guard-only change.

Current hold status (unchanged from baseline):

```
$ npx vitest run tests/integration/m2-model-transport.test.ts -t transport.no-secrets-in-env --reporter=verbose; echo "exit: $?"
 ✓ transport.no-secrets-in-env passes for SECRET_STORE_KEY, CATALOG_WORKLOAD_TOKEN, *_API_KEY
 ✗ LENS_MCP_SECRET_STORE_KEY is NOT rejected (escalated — blocked until resolver lands)
exit: 0
```

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

Failures unchanged from baseline — pre-existing only (`bffRagUiApp.test.tsx` ×2). +3 fence holds added, no regressions.

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

## 7. Escalation — MCP creds + `transport.no-secrets-in-env`

**Blocked pairing:** `endsWith("SECRET_STORE_KEY")` predicate + in-process `EncryptedSqliteSecretStore` in `loadMcpTools` are incompatible. Ship together or not at all.

**Required follow-up (~180 lines, B2-adjacent or post-B2):**

```
services/mcp-registry/McpSecretResolverPort.ts   (~25 lines)
  resolveCredential(serverId): Promise<{ credentialRef: string }>

orchestrator-service/src/mcpSecretResolverClient.ts   (~60 lines)
  HTTP client; env: LENS_MCP_SECRET_RESOLVER_URL + workload token

orchestrator-service/src/main.ts — loadMcpTools   (~40 lines)
  Drop EncryptedSqliteSecretStore + LENS_MCP_SECRET_STORE_KEY from orchestrator wiring

services/mcp-registry/McpCredentialBroker.ts   (~30 lines)
  Accept resolver port; resolve ref at dispatch

services/agent-integration/modelTransport.ts   (1 line, after resolver)
  endsWith("SECRET_STORE_KEY") in assertAgentEnvironment

tests/unit/mcpSecretResolver.test.ts + transport hold extension   (~25 lines)
```

**FenceLedger is not a secret store** — no credential bytes, refs, or MCP wiring in this module.

## 8. Invariants confirmed

- ADR-005-004: Fence replay across replicas rejected via shared durable ledger
- Protected paths `contracts/**`, `services/secrets/**`, `services/agent-integration/**` untouched
- Default single-replica PDP behavior byte-identical (`m03Pdp.test.ts` unmodified)
- `consumeFence` remains synchronous; `FenceLedger.consume` is sync boolean, not async `ClaimStore`
