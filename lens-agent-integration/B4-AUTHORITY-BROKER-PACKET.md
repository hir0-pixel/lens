# B4 Review Packet — Agent Authority Broker

Branch: `codex/b4-authority-broker`
Worktree: `/Users/rameelmalik/Documents/Lens/lens-wt-b4-authority-broker`

## 1. Diffstat

```
 agent-authority-service/package.json               |  21 ++
 agent-authority-service/src/main.ts                | 141 +++++++++++++
 agent-authority-service/tests/broker.test.ts       | 206 ++++++++++++++++++++
 agent-authority-service/tests/spawnAgentAuthority.ts |  89 ++++++++
 agent-authority-service/tsconfig.json              |  15 ++
 agent-authority-service/vitest.config.ts           |   1 +
 orchestrator-service/src/main.ts                   |  49 +++--
 orchestrator-service/tests/m6cMcpProdWiring.test.ts |  49 +++--
 orchestrator-service/tests/mainProductionStartup.test.ts |  2 +
 orchestrator-service/vitest.config.ts              |   8 +-
 scripts/dev/rag-stack-setup.mjs                    |  17 +-
 scripts/dev/rag-stack.mjs                          |  10 +-
 services/agent-authority/AgentAuthorityHttpClient.ts |  94 +++++++++
 services/agent-integration/modelTransport.ts       |   1 +
 services/internal-http/syncInternalPost.ts         |  46 +++++
 services/internal-http/syncInternalPostWorker.cjs  |  58 ++++++
 services/mcp-registry/McpCredentialBroker.ts       |  51 ++---
 services/mcp-registry/McpSecretResolver.ts         |  48 +++++
 services/pdp/FenceLedger.ts                        |  10 +
 tests/integration/m2-model-transport.test.ts       |   2 +-
```

## 2. Protected-path diffstat

```
$ git diff --stat -- services/agent-integration/modelTransport.ts
 services/agent-integration/modelTransport.ts | 1 +
 1 file changed, 1 insertion(+)
```

Single predicate only: `|| name.endsWith("SECRET_STORE_KEY")` in `assertAgentEnvironment`.

## 3. Service route table (`agent-authority-service`)

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/v1/fences/consume` | `{ fence_id }` | `{ consumed: true\|false }` — atomic first-wins on shared `SqliteFenceLedger` |
| POST | `/v1/mcp/credentials/issue` | `{ credential_ref, execution_fence, secret_ref, target_ref, expires_at }` | `{ credential_ref }` — registers issued ref (spec gap; required for resolve) |
| POST | `/v1/mcp/credentials/resolve` | `{ credential_ref, execution_fence }` | `{ secret, target_ref, credential_ref }` or **403** — lookup issued row, fence/TTL match, `ledger.consume(execution_fence)`, decrypt |

MCP `execution_fence` uses `mcp-fence:${requestId}:${toolCallId}` (see `mcpTool.ts`); PDP fence IDs are separate and consumed in `before_tool`.

## 4. Hold evidence (real exit codes)

### `broker.fence-consume-atomic-across-replicas`

```
$ cd agent-authority-service && npx vitest run tests/broker.test.ts -t broker.fence-consume-atomic-across-replicas --reporter=verbose; echo "exit: $?"
 ✓ broker.fence-consume-atomic-across-replicas
 Test Files  1 passed (1)
      Tests  1 passed | 4 skipped (5)
exit: 0
```

Service spawned in a **child process** (HttpFenceLedger `Atomics.wait` + in-process HTTP would deadlock). Two `HttpFenceLedger` clients; first `consumeFence` wins, second throws `PdpError`; direct `consume(fenceId)` returns `false`.

### `broker.credential-requires-live-fence`

```
$ cd agent-authority-service && npx vitest run tests/broker.test.ts -t broker.credential-requires-live-fence --reporter=verbose; echo "exit: $?"
 ✓ broker.credential-requires-live-fence
exit: 0
```

Expired TTL, replayed credential, and second resolve on consumed `mcp-fence:*` → 403; secret never returned.

### `broker.orchestrator-env-has-no-secret-key`

```
$ cd agent-authority-service && npx vitest run tests/broker.test.ts -t broker.orchestrator-env-has-no-secret-key --reporter=verbose; echo "exit: $?"
 ✓ broker.orchestrator-env-has-no-secret-key
exit: 0
```

`LENS_MCP_SECRET_STORE_KEY` rejected by `assertAgentEnvironment`; production-shaped env without it passes.

### `broker.orchestrator-holds-refs-only`

```
$ cd agent-authority-service && npx vitest run tests/broker.test.ts -t broker.orchestrator-holds-refs-only --reporter=verbose; echo "exit: $?"
 ✓ broker.orchestrator-holds-refs-only
exit: 0
```

No secret value in `process.env` or orchestrator→service request bodies; resolve response may carry secret to connector only.

### `broker.production-requires-service`

```
$ cd agent-authority-service && npx vitest run tests/broker.test.ts -t broker.production-requires-service --reporter=verbose; echo "exit: $?"
 ✓ broker.production-requires-service
exit: 0
```

Production without `LENS_AGENT_AUTHORITY_URL`/`TOKEN` throws from `loadAgentAuthorityClient` and `loadMcpTools`.

### Regression

```
$ cd agent-authority-service && npx vitest run tests/broker.test.ts; echo "exit: $?"
 Test Files  1 passed (1)
      Tests  5 passed (5)
exit: 0

$ cd orchestrator-service && npx vitest run; echo "exit: $?"
 Test Files  26 passed (26)
      Tests  208 passed (208)
exit: 0

$ npx vitest run tests/unit/mcpConnector.test.ts; echo "exit: $?"
 Test Files  1 passed (1)
      Tests  11 passed (11)
exit: 0

$ npx vitest run; echo "exit: $?"
 Test Files  2 failed | 86 passed (88)
      Tests  2 failed | 444 passed (446)
exit: 1
```

Root failures unchanged (pre-existing `bffRagUiApp` / `ragChat` baseline only).

## 5. Orchestrator env — before / after

**Removed from orchestrator (MCP secrets moved to service):**

- `LENS_MCP_SECRET_STORE_PATH` / `MCP_SECRET_STORE_PATH` in `OrchestratorServiceEnv` and `loadEnv`
- `LENS_MCP_SECRET_STORE_KEY` / `MCP_SECRET_STORE_KEY` in `OrchestratorServiceEnv` and `loadEnv`
- `EncryptedSqliteSecretStore` in `loadMcpTools`

**Added:**

- `LENS_AGENT_AUTHORITY_URL` / `AGENT_AUTHORITY_URL`
- `LENS_AGENT_AUTHORITY_WORKLOAD_TOKEN` / `AGENT_AUTHORITY_WORKLOAD_TOKEN`

**Unchanged / wiring rules:**

- `LENS_AGENT_FENCE_LEDGER_PATH` — dev/test fallback when authority URL absent
- Production: `LENS_AGENT_AUTHORITY_URL` + token required
- When URL **and** PATH both set, **URL wins** (`HttpFenceLedger` in `loadAgentPolicyReplica`; no local `SqliteFenceLedger`)
- `LENS_MCP_REGISTRY_PATH` set → authority URL + token required (all profiles)

**Dev stack (`rag-stack-setup.mjs`):** `agent-authority.env` holds `LENS_MCP_SECRET_STORE_*`; orchestrator.env gets authority URL/token only.

## 6. Implementation notes

- **HttpFenceLedger:** `worker_threads` + `SharedArrayBuffer` + `Atomics.wait` around HTTP in `syncInternalPostWorker.cjs`; timeout/non-2xx/network → `consume()` returns `false` (fail closed, no throw).
- **Wiring:** `HttpFenceLedger` constructed in `loadAgentPolicyReplica` (`main.ts`); passed via existing `fenceLedger` option. `loadAgentFenceLedger` signature unchanged.
- **Tests:** `McpCredentialBroker(registry, secrets)` preserved for `tests/unit/mcpConnector.test.ts`; production `loadMcpTools` uses `RemoteMcpSecretResolver` + HTTP client.

## 7. Untouched (confirmed)

`PolicyDecisionPoint.ts`, `agentHarness.ts`, `agentPdpReplica.ts` (signature frozen), `contracts/**`.
