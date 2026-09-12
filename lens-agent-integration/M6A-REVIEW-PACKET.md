# M6a Review Packet — MCP Registry, Connector, Schema Pinning

Parent commit: `6b1eacceb6040cfaba2adbf0f345630442280bb4` ("docs: add M6 MCP tools module spec")
Branch: `agent/m6a-mcp-registry`

---

## 1. `git diff --stat` against the parent commit

```
 scripts/manual/m6a-mcp-evidence.ts              |  83 +++++++++
 server/src/config/index.ts                      |   1 +
 server/src/index.ts                             |   9 +-
 server/src/routes/api.ts                        |   6 +
 server/src/routes/mcpServers.ts                 | 126 +++++++++++++
 server/tests/mcpServers.test.ts                 | 112 ++++++++++++
 services/mcp-registry/McpCredentialBroker.ts    |  71 ++++++++
 services/mcp-registry/McpHttpConnector.ts       | 118 ++++++++++++
 services/mcp-registry/McpRegistry.ts            | 232 ++++++++++++++++++++++++
 services/mcp-registry/adminService.ts           | 122 +++++++++++++
 services/mcp-registry/healthProbe.ts            |  54 ++++++
 services/mcp-registry/schemaDigest.ts           |  10 +
 services/mcp-registry/wireProtocol.ts           |  60 ++++++
 services/tool-execution/ToolExecutionService.ts |   2 +-
 tests/helpers/stubMcpServer.ts                  | 123 +++++++++++++
 tests/unit/mcpConnector.test.ts                 | 212 ++++++++++++++++++++++
 tests/unit/toolExecutionGolden.test.ts          | 162 +++++++++++++++++
 17 files changed, 1501 insertions(+), 2 deletions(-)
```

## 2. `git diff --stat` on every protected path (must be empty)

```
$ git diff --stat HEAD -- services/pdp services/retrieval services/agent-runtime contracts \
    services/agent-integration orchestrator-service/src/agentHarness.ts services/secrets \
    server/src/routes/providers.ts
```
Output: **empty.** No protected path was touched.

## 3. `services/tool-execution/ToolExecutionService.ts` diff — additions only

```diff
-export interface Sandbox { dispatch(input: { targetRef: string; action: string; credentialRef: string; executionFence: string; idempotencyKey: string; argumentsDigest: string }): Promise<{ status: "succeeded" | "unknown" }>; }
+export interface Sandbox { dispatch(input: { targetRef: string; action: string; credentialRef: string; executionFence: string; idempotencyKey: string; argumentsDigest: string }): Promise<{ status: "succeeded" | "unknown"; result?: { content: string; resourceRefs: readonly string[] } }>; }
```

This is the entire diff to the file. Nothing else in it changed — same input shape on `dispatch`, same body of `execute`, same `ToolCatalogEntry`/`CredentialBroker`/`ToolExecutionError`.

**Golden test:** `tests/unit/toolExecutionGolden.test.ts` (7 tests, all passing) proves:
- A legacy `Sandbox` that returns exactly `{ status }` and never looks at `result` still satisfies the interface and produces byte-identical `execute()` behaviour.
- Every `Sandbox.dispatch` call is asserted against the exact literal object (`toEqual`) it received before this change — same six keys, same values, nothing added.
- Success, idempotent replay, conflict, forbidden (unknown tool / missing fence / `externalCapable`), awaiting-approval, and dependency-unavailable paths are all re-verified.
- A `Sandbox` that *does* return the new optional `result` field produces an identical `execute()` return value (`ToolState`), proving the field is inert to every existing caller.

## 4. Full output of every named test, run individually

### `mcp.admin-only` (server/tests/mcpServers.test.ts)
```
 RUN  v3.2.7 .../server
 ✓ tests/mcpServers.test.ts (4 tests | 3 skipped) 19ms
 Test Files  1 passed (1)
      Tests  1 passed | 3 skipped (4)
```

### `mcp.http-only`
```
 RUN  v3.2.7 .../server
 ✓ tests/mcpServers.test.ts (4 tests | 3 skipped) 21ms
 Test Files  1 passed (1)
      Tests  1 passed | 3 skipped (4)
```

### `mcp.no-secret-in-responses`
```
 RUN  v3.2.7 .../server
 ✓ tests/mcpServers.test.ts (4 tests | 3 skipped) 33ms
 Test Files  1 passed (1)
      Tests  1 passed | 3 skipped (4)
```

### `mcp.unapproved-tool-absent`
```
 RUN  v3.2.7 .../server
 ✓ tests/mcpServers.test.ts (4 tests | 3 skipped) 31ms
 Test Files  1 passed (1)
      Tests  1 passed | 3 skipped (4)
```

### All four together, verbose (`cd server && npx vitest run tests/mcpServers.test.ts --reporter=verbose`)
```
 ✓ tests/mcpServers.test.ts > mcp admin routes > mcp.admin-only: unauthenticated and non-admin registration are refused 19ms
 ✓ tests/mcpServers.test.ts > mcp admin routes > mcp.http-only: a stdio or unknown transport is rejected at registration 6ms
 ✓ tests/mcpServers.test.ts > mcp admin routes > mcp.no-secret-in-responses: registration, discovery, and approval never echo the endpoint or secret_ref 15ms
 ✓ tests/mcpServers.test.ts > mcp admin routes > mcp.unapproved-tool-absent: a discovered-but-unapproved tool is not in the catalog 8ms
 Test Files  1 passed (1)
      Tests  4 passed (4)
```

### `mcp.credential-never-in-process` (tests/unit/mcpConnector.test.ts)
```
 RUN  v3.2.7 ...
 ✓ tests/unit/mcpConnector.test.ts (7 tests | 6 skipped) 26ms
 Test Files  1 passed (1)
      Tests  1 passed | 6 skipped (7)
```

### `mcp.schema-drift-blocks`
```
 ✓ tests/unit/mcpConnector.test.ts (7 tests | 6 skipped) 23ms
 Test Files  1 passed (1)
      Tests  1 passed | 6 skipped (7)
```

### `mcp.unreachable-fails-closed`
```
 ✓ tests/unit/mcpConnector.test.ts (7 tests | 6 skipped) 28ms
 Test Files  1 passed (1)
      Tests  1 passed | 6 skipped (7)
```

### `mcp.result-bounded`
```
 ✓ tests/unit/mcpConnector.test.ts (7 tests | 6 skipped) 30ms
 Test Files  1 passed (1)
      Tests  1 passed | 6 skipped (7)
```

### All connector tests together, verbose (`npx vitest run tests/unit/mcpConnector.test.ts --reporter=verbose`)
```
 ✓ tests/unit/mcpConnector.test.ts > MCP HTTP connector > calls an approved tool and returns bounded content with provenance refs 25ms
 ✓ tests/unit/mcpConnector.test.ts > MCP HTTP connector > mcp.credential-never-in-process: the secret value appears in neither process.env nor the connector's call arguments 12ms
 ✓ tests/unit/mcpConnector.test.ts > MCP HTTP connector > mcp.schema-drift-blocks: a changed live schema blocks the call, marks the tool drifted, and never reaches the tool handler 6ms
 ✓ tests/unit/mcpConnector.test.ts > MCP HTTP connector > mcp.unreachable-fails-closed: an unreachable server fails closed with DEPENDENCY_UNAVAILABLE and no retry 7ms
 ✓ tests/unit/mcpConnector.test.ts > MCP HTTP connector > mcp.result-bounded: an oversized result is truncated with a marker in a single call 9ms
 ✓ tests/unit/mcpConnector.test.ts > MCP HTTP connector > boundContent never splits a multi-byte UTF-8 character 4ms
 ✓ tests/unit/mcpConnector.test.ts > MCP HTTP connector > health probe marks tools unavailable when the server is unreachable, and calls block without a network attempt 7ms
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

### Tool-execution golden test (`npx vitest run tests/unit/toolExecutionGolden.test.ts --reporter=verbose`)
```
 ✓ ... succeeds and dispatches with the exact pre-existing argument shape, byte-identical JSON 1ms
 ✓ ... idempotent replay returns the cached state without a second dispatch call 0ms
 ✓ ... conflicts when the same idempotency key is replayed with different arguments 0ms
 ✓ ... rejects an unknown tool, a missing fence, and an externalCapable tool as FORBIDDEN 0ms
 ✓ ... returns AWAITING_APPROVAL without dispatching, then proceeds once an approvalRef is supplied 0ms
 ✓ ... wraps any Sandbox.dispatch rejection as DEPENDENCY_UNAVAILABLE, exactly as before 0ms
 ✓ ... a Sandbox that DOES return the new optional `result` field still behaves identically at the execute() boundary 0ms
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

## 5. Full-suite regression check

- **Baseline** (parent commit, clean): `npm test` → `Test Files 2 failed | 82 passed (84)`, `Tests 10 failed | 425 passed (435)`. The 10 failures are exactly the pre-documented set: 8 in `tests/e2e/ragChat.test.ts`, 2 in `tests/unit/bffRagUiApp.test.tsx`. Neither file was touched.
- **After M6a**: `npm test` → `Test Files 2 failed | 84 passed (86)`, `Tests 10 failed | 439 passed (449)`. Same 10 failures, same two files, same error messages. The delta (+2 files, +14 tests) is exactly `tests/unit/mcpConnector.test.ts` (7) and `tests/unit/toolExecutionGolden.test.ts` (7).
- **`server/` package** (separate suite, holds `mcpServers.test.ts`): baseline `Test Files 2 failed | 8 passed (10)`, `Tests 2 failed | 76 passed (78)` (pre-existing: `providerCatalog.test.ts` "mounts ingestion..." and `rag.test.ts` "enforces request deadlines" — both verified pre-existing by re-running the identical suite with M6a's changes stashed out). After M6a: `Test Files 2 failed | 9 passed (11)`, `Tests 2 failed | 80 passed (82)` — same two pre-existing failures, +4 tests from the new `mcpServers.test.ts`.
- `npm run typecheck` → `exit: 0`.
- `npm run lint` → `exit: 0` (21 pre-existing warnings, 0 errors, none in new files).
- `npm run validate` fails only because it runs the same 10 pre-existing test failures — not a new regression.

## 6. Captured connector call — `credentialRef` present, secret value absent

Produced by `scripts/manual/m6a-mcp-evidence.ts` (`npx vite-node scripts/manual/m6a-mcp-evidence.ts`):

```
=== EVIDENCE 1: connector call — credentialRef present, secret value absent ===
dispatch input (this is exactly what the orchestrator process holds):
{
  "targetRef": "mcp:mcp_0ea7449ec96f46d68d7acac3",
  "action": "agent.tool.mcp.echo",
  "credentialRef": "mcpcred_c5b69b79d1d24f46b1b703d8",
  "executionFence": "fence-evidence-1",
  "idempotencyKey": "evidence-idem-1",
  "argumentsDigest": "sha256:evidence"
}
process.env contains secret value: false
dispatch input contains secret value: false
dispatch outcome: {
  "status": "succeeded",
  "result": {
    "content": "hello from the stub",
    "resourceRefs": []
  }
}
MCP server actually received the secret (as a Bearer header, out of band from the orchestrator): true
```

The dispatch input the orchestrator would hold carries only `credentialRef`; the raw secret value never appears there or in `process.env`. It does reach the MCP server itself (as a Bearer header) — that is the connector's job, and it happens entirely inside the connector, not the orchestrator process. `tests/unit/mcpConnector.test.ts`'s `mcp.credential-never-in-process` test asserts this same pair of facts programmatically.

## 7. Schema-drift test output — block and `drifted` transition

Same script, continued:

```
=== EVIDENCE 2: schema drift blocks the call and transitions registry state to 'drifted' ===
tool state before the drifted call: approved
dispatch threw as expected: MCP tool schema drift detected; the tool has been marked drifted and blocked.
tool state after the drifted call: drifted
stub's tools/call handler was invoked during the drifted attempt: false
```

`tests/unit/mcpConnector.test.ts`'s `mcp.schema-drift-blocks` test additionally proves a *second* dispatch attempt against the now-`drifted` tool is blocked before any network attempt at all (`stub.listCount` does not move), which is what "unavailable/drifted tools block without a network attempt" means in practice.

## 8. Things inferred beyond the spec's literal text

The spec is authoritative; where it was silent or terser than the code required, these are the calls made and why:

1. **Storage backend.** The spec says "SQLite local / Postgres production — look at how the provider registry does it," but the provider registry (`services/provider-registry/ProviderRegistry.ts`) only has a SQLite implementation in this repo (no Postgres variant exists anywhere for it, confirmed by `grep`). I built `SqliteMcpRegistry` as a structural match to `SqliteProviderRegistry` (same `DatabaseSync` pattern, same id-prefix convention, same `CREATE TABLE IF NOT EXISTS`) and did not invent a Postgres implementation that has no precedent to match against. A Postgres implementation would be new infrastructure, not something M6a asked for.
2. **Per-tool vs per-server `state`.** The spec's one sentence — "approved tools each with `schemaDigest`, `resultAuthorization` mode... and `state` ∈ {approved, drifted, unavailable, disabled}" — reads as `state` being a property of each *approved tool* row, not the server row (schema drift and unavailability are inherently tool-scoped: one tool on a server can drift while another stays fine). I gave the server row its own simpler `disabled: boolean` and kept the four-state enum on the tool row. Route responses still return `{ id, state }` for every admin action, using the appropriate row's state.
3. **Truncation marker text.** M6a's holds table says "truncate with a marker, as `corpusTool.ts` does" — but `corpusTool.ts`'s `boundedExcerpts` truncates by byte-safe slicing with **no** literal marker string appended. Since `mcp.result-bounded` explicitly requires a marker, I added one (`"\n[truncated]"`), budgeted into the byte limit so the total never exceeds `maxOutputBytes`, and kept the UTF-8-safe slicing technique from `corpusTool.ts`.
4. **MCP wire protocol.** Nothing in this repo talks MCP yet. I modelled the connector's/stub's request-response shape on real MCP's JSON-RPC 2.0 `tools/list`/`tools/call` methods (tool `name` + `inputSchema`, per the actual MCP spec), narrowed to HTTP-only, single-request/response, no streaming — since the M6 spec explicitly scopes this module to HTTP transport only.
5. **`Sandbox.dispatch`'s missing arguments.** `ToolExecutionService.execute`'s signature only threads an `argumentsDigest` down to `Sandbox.dispatch` — never the actual tool-call arguments. That signature is protected (only the additive `result` field may change), so the connector cannot receive dynamic MCP tool arguments through this path in M6a. The stub's two tools are argument-less by design for exactly this reason; wiring real per-call arguments through to the MCP server is necessarily a concern for M6b's harness wrapper (which may need a different call path than `ToolExecutionService.execute`, or an extension to it — that decision belongs to M6b, not this module).
6. **Credential single-use and fence-binding.** `CredentialBroker`/`Sandbox` don't force single-use or fence-checked credential resolution — I added both anyway (`McpCredentialBroker.resolve` deletes the entry on first use and rejects a fence mismatch) as a stricter-than-required interpretation of "credentials never enter the agent process" and "bound to the execution fence" from the spec's §4a. This is additive safety, not a requirement I could point to a specific test name for.
7. **Health-probe scheduling.** I implemented `probeMcpServerHealth` as a single pass that a caller invokes (and tested it that way). Scheduling it on an interval in a running process is a deployment/wiring concern the spec doesn't test by name, so I left that to whoever wires this into a long-running service (noted as a TODO-shaped comment in `healthProbe.ts`, not implemented).
8. **Admin route wiring into the real BFF app.** Beyond the router itself, I wired `createMcpServersRouter` into `server/src/routes/api.ts` and `server/src/index.ts` (optional `mcpAdmin` parameter, defaulted to a `SqliteMcpRegistry`-backed `McpAdminService` when not supplied) and added `MCP_REGISTRY_PATH` to `server/src/config/index.ts` as an optional env var, mirroring `PROVIDER_REGISTRY_PATH` exactly. I deliberately did **not** add it to `validateProductionConfig`'s required-in-production list — that list is a separate, already-tested contract (`providerCatalog.test.ts`'s "fails closed in production" test) and extending it wasn't asked for and risked an unrelated regression.
9. **Route/test placement.** `providers.ts`-shaped admin routes in this repo have their integration tests under `server/tests/` (see `providerCatalog.test.ts`), which is a separate Vitest suite from the root `npm test`. I followed that precedent for `mcpServers.test.ts` rather than root `tests/unit/`, since the root suite doesn't have `express`/`supertest`/`cookie-parser` installed. The connector/registry/golden tests, which only depend on root dependencies, live under root `tests/unit/` per the root `vitest.config.ts` include list.
10. **`@vitest-environment node` pragma.** The two new test files that open a real `node:http` server and use the global `fetch` (`tests/unit/mcpConnector.test.ts`) needed the `node` environment pragma — the root suite's default `jsdom` environment's `fetch` could not reach a local `node:http` server (confirmed by isolating the failure: identical code succeeded under plain `node` and under `@vitest-environment node`, failed under the suite's default `jsdom` environment). This matches existing precedent in the repo (`tests/unit/productionRagLoad.test.ts` and others already use the same pragma for the same reason).

## 9. Files touched (all under this branch's diff)

- `services/mcp-registry/McpRegistry.ts` — durable registry (types + `SqliteMcpRegistry`)
- `services/mcp-registry/schemaDigest.ts` — `sha256(canonicalJson(inputSchema))`, shared by admin service and connector
- `services/mcp-registry/wireProtocol.ts` — MCP JSON-RPC request/response shapes, JSON-path resolver
- `services/mcp-registry/McpCredentialBroker.ts` — `CredentialBroker` implementation; single-use, fence-bound `credentialRef` issuance/resolution
- `services/mcp-registry/McpHttpConnector.ts` — `Sandbox` implementation: schema-drift check, bounded truncation, provenance extraction
- `services/mcp-registry/healthProbe.ts` — single-pass health probe, `unavailable`/recovery transitions
- `services/mcp-registry/adminService.ts` — registration, discovery, approval, disable
- `server/src/routes/mcpServers.ts` — admin routes (`requireAdmin`, reused from `providers.ts`; CSRF inherited from the `/api` mount)
- `server/src/routes/api.ts` — additive: mounts the new router when `mcpAdmin` is supplied
- `server/src/index.ts` — additive: constructs a default `McpAdminService`/`SqliteMcpRegistry`, threads `mcpAdmin` through
- `server/src/config/index.ts` — additive: `MCP_REGISTRY_PATH` optional env var
- `services/tool-execution/ToolExecutionService.ts` — the one additive line described above
- `tests/helpers/stubMcpServer.ts` — controllable stub MCP HTTP server (schema mutation, take-down, call counters)
- `tests/unit/mcpConnector.test.ts`, `tests/unit/toolExecutionGolden.test.ts`, `server/tests/mcpServers.test.ts` — the named holds
- `scripts/manual/m6a-mcp-evidence.ts` — the evidence script behind §6/§7 above
