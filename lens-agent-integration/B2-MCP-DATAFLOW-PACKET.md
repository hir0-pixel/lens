# B2 Review Packet — MCP server data-flow review (F-P2)

Branch: `codex/b2-mcp-dataflow`
Worktree: `/Users/rameelmalik/Documents/Lens/lens-wt-b2-mcp-dataflow`
Backlog: `12-BACKLOG-TOP3.md` §B2

---

## 1. `git diff --stat`

```
 platform/build/approved-egress.json                |  9 +++
 orchestrator-service/src/agentHarness.ts           |  9 +-
 orchestrator-service/src/main.ts                   |  6 +-
 orchestrator-service/tests/m6cMcpProdWiring.test.ts |  7 +-
 server/src/routes/mcpServers.ts                    |  8 ++
 server/tests/mcpServers.test.ts                    |  5 +-
 services/mcp-registry/McpHttpConnector.ts          | 11 +++
 services/mcp-registry/McpRegistry.ts               | 42 ++++++++-
 services/mcp-registry/adminService.ts              | 30 +++++--
 services/mcp-registry/dataFlowProfile.ts            | 65 ++++++++++++++
 tests/helpers/mcpDataFlow.ts                       | 16 ++++
 tests/unit/mcpConnector.test.ts                    | 116 ++++++++++++++++++++-
 12 files changed, ~300 insertions
```

## 2. Protected-path diffstat (must be empty)

```
$ git diff --stat HEAD -- services/pdp services/agent-integration contracts \
    services/secrets platform/build/dependency-mirrors.json
```

Output: **empty.**

## 3. Build summary

- **`dataFlowProfile`** on `McpToolRecord`, `McpToolApprovalInput`, `ApproveToolInput`, and BFF `approveSchema`: `{ egressClass: "none" | "internal" | "external-approved", targets: string[] }`. Not on `McpServerRecord`.
- **Registration refused** without a valid profile (`DATA_FLOW_PROFILE_REQUIRED` / HTTP 400).
- **Persisted** as JSON TEXT in `mcp_tools.data_flow_profile`; `ALTER TABLE` adds nullable column on legacy DBs — NULL/empty rows fail closed at read until re-approved.
- **External egress gate:** `platform/build/approved-egress.json` (sibling to `dependency-mirrors.json`, same `schemaId`/`owner`/`version` shape). `McpHttpConnector` injects `policy.allowedDestinations` hostnames; refuses `external-approved` tools **before any HTTP**, keyed on server endpoint hostname (not `targets[]`).
- **Digest:** `computeDataFlowProfileDigest` — `sha256(canonicalJson({ egressClass, targets: sorted }))`, mirroring `schemaDigest.ts`. Surfaced via `registerTool({ ...mcpRuntimeCatalogEntry(d), dataFlowProfileDigest })` in `agentHarness.ts`; `loadMcpTools` threads `dataFlowProfile` onto descriptors only (no other `main.ts` edits). **`mcpTool.ts` untouched.**

## 4. Named holds — real exit codes

### `mcp.registration-requires-data-flow`

```
 ✓ tests/unit/mcpConnector.test.ts (11 tests | 10 skipped)
 Test Files  1 passed (1)
      Tests  1 passed | 10 skipped (11)
exit: 0
```

### `mcp.external-egress-refused-unless-approved`

```
 ✓ tests/unit/mcpConnector.test.ts (11 tests | 10 skipped)
 Test Files  1 passed (1)
      Tests  1 passed | 10 skipped (11)
exit: 0
```

### `mcp.data-flow-digest-is-real`

```
 ✓ tests/unit/mcpConnector.test.ts (11 tests | 10 skipped)
 Test Files  1 passed (1)
      Tests  1 passed | 10 skipped (11)
exit: 0
```

## 5. Gates

| Gate | Result |
|---|---|
| `npm run typecheck; echo "exit: $?"` | **0** |
| `npm test` | **2 failed** (baseline `bffRagUiApp.test.tsx` ×2 only; no new failures vs 10 known-red set) |
| Protected diffstat | **empty** |

## 6. Commands run

```bash
npm run typecheck; echo "exit: $?"          # → 0
npm test; echo "exit: $?"                   # → 2 failed (baseline), 438 passed
npx vitest run tests/unit/mcpConnector.test.ts server/tests/mcpServers.test.ts orchestrator-service/tests/m6cMcpProdWiring.test.ts  # → 0
```
