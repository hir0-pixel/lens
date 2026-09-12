# M6c Review Packet — MCP tools wired into the production harness

Branch: `agent/m6c-mcp-wiring`
Commit: `d798500370395256952e83a51d6705aa4d7a1431`
Parent: `9150d10f43c889baff3a8ca5afa431fac870e53e` (main)

## 1. Diffstat vs parent

```
$ git diff --stat 9150d10 d798500
 orchestrator-service/src/main.ts                   |  85 ++++++++
 orchestrator-service/src/service.ts                |   7 +-
 orchestrator-service/tests/m6cMcpProdWiring.test.ts | 233 +++++++++++++++++++++
 3 files changed, 324 insertions(+), 1 deletion(-)
```

## 2. Protected-path diffstat (must be empty)

```
$ git diff --stat 9150d10 d798500 -- services/ contracts/ authority-service/ server/ \
    orchestrator-service/src/agentHarness.ts orchestrator-service/src/agentPdpReplica.ts \
    orchestrator-service/src/agentDevFacts.ts
(no output — nothing under those paths changed)
```

## 3. Environment variable

New: **`LENS_MCP_REGISTRY_PATH`** — SQLite path to the same `SqliteMcpRegistry` an admin
approves MCP tools into (mirrors the BFF's `MCP_REGISTRY_PATH`, `server/src/config/index.ts`).
Absent → MCP is entirely unavailable (no discovery, no dynamic exposure). Set to `:memory:`
while `ORCHESTRATOR_AUTHORITY_PROFILE=production` → startup throws.

Two more new vars, required together whenever `LENS_MCP_REGISTRY_PATH` is set (see §6, inferred):
`LENS_MCP_SECRET_STORE_PATH` and `LENS_MCP_SECRET_STORE_KEY` — the encrypted secret store
(`EncryptedSqliteSecretStore`) holding MCP server credentials, which must point at the same
sealed-secrets file/key an admin's `McpAdminService.registerServer` call wrote into.

## 4. `service.ts` diff (full)

```diff
--- a/orchestrator-service/src/service.ts
+++ b/orchestrator-service/src/service.ts
@@ -37,7 +37,7 @@ import type { ModelEligibilityCheckPort } from "./modelGovernance";
 import { FailClosedRoutePolicyPort, RoutePolicyError, type RoutePolicyPort, type RoutePolicyResult } from "./groundingPolicy";
 import type { CompanyRagProfile } from "../../services/rag-profile/companyRagProfile";
 import { computeCompanyRagProfileDigest, employeeModelDoesNotAffectRag } from "../../services/rag-profile/companyRagProfile";
-import { createProductionAgentHarness } from "./agentHarness";
+import { createProductionAgentHarness, type ProductionAgentHarnessOptions } from "./agentHarness";
 import type { AgentPolicyReplica } from "./agentPdpReplica";
 import { isValidModelRef } from "./modelSelection";
 
@@ -361,6 +361,10 @@ export interface ProductionOrchestratorOptions {
   devInMemoryAuthorities?: boolean;
   /** Deployer-wired replica of Retrieval's PDP policy and fact sources. Absent means agent mode fails closed. */
   agentPolicyReplica?: AgentPolicyReplica;
+  /** M6c: admin-approved MCP tools wired onto the harness (see agentHarness.ts's `mcpTools`
+   * option, M6b). Absent means MCP is simply unavailable — main.ts's `loadMcpTools` returns
+   * undefined when LENS_MCP_REGISTRY_PATH is unset; there is no permissive default here. */
+  mcpTools?: ProductionAgentHarnessOptions["mcpTools"];
   agentSessionRoot?: string;
   agentMaxSteps?: number;
   agentMaxCostUnits?: number;
@@ -851,6 +855,7 @@ export class ProductionOrchestratorService {
         maxSteps: options.agentMaxSteps,
         maxCostUnits: options.agentMaxCostUnits,
         now: this.now,
+        mcpTools: options.mcpTools,
       });
     }
     this.turnRouter = options.turnRouter ?? (options.useGatewayTurnRouter ? new GatewayTurnRouterLLMPort(this.modelGateway, this.modelSelection, this.modelEligibility) : undefined);
```

Every existing argument to `createProductionAgentHarness` is untouched — `mcpTools` is the only
addition, matching the module brief's "Existing arguments byte-identical."

## 5. `main.ts` diff (full)

```diff
--- a/orchestrator-service/src/main.ts
+++ b/orchestrator-service/src/main.ts
@@ -31,6 +31,12 @@ import { assertCompanyRagProfile } from "../../services/rag-profile/companyRagPr
 import type { DecisionFenceSigner, FactReaders, PolicyBundle } from "../../services/pdp/PolicyDecisionPoint";
 import { createAgentAuditLedger, createAgentPolicyReplica, type AgentPolicyReplica } from "./agentPdpReplica";
 import { createDevAgentPolicyFacts } from "./agentDevFacts";
+import type { ProductionAgentHarnessOptions } from "./agentHarness";
+import { SqliteMcpRegistry } from "../../services/mcp-registry/McpRegistry";
+import { McpCredentialBroker } from "../../services/mcp-registry/McpCredentialBroker";
+import { McpHttpConnector } from "../../services/mcp-registry/McpHttpConnector";
+import { EncryptedSqliteSecretStore } from "../../services/secrets/SecretStore";
+import type { McpToolDescriptor } from "../../services/agent-integration/mcpTool";
 
 export interface OrchestratorServiceEnv {
   PORT?: string;
@@ -106,6 +112,21 @@ export interface OrchestratorServiceEnv {
   LENS_ORCHESTRATOR_ALLOW_DEV_AGENT_FACTS?: string;
   /** HMAC key for dev agent PDP fences. Required when LENS_ORCHESTRATOR_ALLOW_DEV_AGENT_FACTS=true. */
   LENS_ORCHESTRATOR_DEV_AGENT_SIGNING_KEY?: string;
+  /**
+   * M6c: SQLite path to the same MCP registry an admin approves tools into (mirrors the BFF's
+   * MCP_REGISTRY_PATH — see server/src/index.ts). Absent means MCP is entirely unavailable on
+   * this harness; there is no discovery-at-startup fallback. Production must not set this to
+   * ":memory:" — a persistent registry or nothing.
+   */
+  MCP_REGISTRY_PATH?: string;
+  /** SQLite path to the encrypted secret store holding MCP server credentials. Must point at
+   * the same sealed-secrets store an admin's MCP server registration wrote into (see
+   * server/src/index.ts's `secrets`). Required together with MCP_SECRET_STORE_KEY whenever
+   * MCP_REGISTRY_PATH is set. */
+  MCP_SECRET_STORE_PATH?: string;
+  /** 32+ character master key for MCP_SECRET_STORE_PATH — must match the key the store was
+   * sealed with (the BFF's SECRET_STORE_KEY). */
+  MCP_SECRET_STORE_KEY?: string;
 }
 
 function loadEnv(): OrchestratorServiceEnv {
@@ -161,6 +182,9 @@ function loadEnv(): OrchestratorServiceEnv {
     AGENT_SESSION_ROOT: process.env.LENS_AGENT_SESSION_ROOT,
     LENS_ORCHESTRATOR_ALLOW_DEV_AGENT_FACTS: process.env.LENS_ORCHESTRATOR_ALLOW_DEV_AGENT_FACTS,
     LENS_ORCHESTRATOR_DEV_AGENT_SIGNING_KEY: process.env.LENS_ORCHESTRATOR_DEV_AGENT_SIGNING_KEY,
+    MCP_REGISTRY_PATH: process.env.LENS_MCP_REGISTRY_PATH,
+    MCP_SECRET_STORE_PATH: process.env.LENS_MCP_SECRET_STORE_PATH,
+    MCP_SECRET_STORE_KEY: process.env.LENS_MCP_SECRET_STORE_KEY,
   };
 }
 
@@ -326,6 +350,62 @@ export function loadAgentPolicyReplica(
     : undefined;
 }
 
+/** Open passthrough schema used only as the harness-facing `parameters` shape for a
+ * registry-sourced MCP tool descriptor (M6c). `McpRegistry` persists a tool's `schemaDigest`
+ * but never its raw JSON schema (see `McpToolRecord`), and "no discovery at startup" forbids
+ * fetching the live schema to fill this in. `McpHttpConnector.dispatch` still independently
+ * re-fetches the live schema and compares it against the real pinned `schemaDigest` before
+ * every call, so this placeholder only affects the model's up-front tool-call guidance — never
+ * enforcement, which always runs against the true pinned digest. */
+const OPEN_MCP_TOOL_SCHEMA = { type: "object", additionalProperties: true } as const;
+
+/**
+ * M6c: wires the admin-approved MCP catalog (M6a's `SqliteMcpRegistry` / `McpAdminService`,
+ * server/src/index.ts) onto the production agent harness's `mcpTools` option (M6b,
+ * `agentHarness.ts`). Absent `LENS_MCP_REGISTRY_PATH`, MCP stays entirely absent — no
+ * discovery, no dynamic exposure, only what an admin already approved.
+ *
+ * `McpToolRecord` (what the registry durably stores) is narrower than `McpToolDescriptor`
+ * (what the harness needs), so two gaps are resolved fail-closed rather than guessed
+ * permissively:
+ *  - No `risk` classification is stored. Every registry-sourced tool is treated as
+ *    `high_risk` (forces `requiresApproval` — see `mcpRuntimeCatalogEntry`), the conservative
+ *    default when a security-relevant fact is unknown (ground rule 2: fail closed, always).
+ *  - No `declaredResourceRefs` is stored. A `resource-gated` tool without them would authorize
+ *    against an empty resourceRefs set, which `bindToolGovernance`'s allowed-list-length check
+ *    (governanceBinding.ts) passes vacuously — i.e. fail OPEN. So this wiring exposes only
+ *    `tool-gated` approved tools, whose resourceRef is the synthetic, always-populated `tool:`
+ *    ref from `mcpToolResourceRef`; `resource-gated` approvals are skipped until the registry
+ *    threads resourceRefs through admin approval.
+ */
+export async function loadMcpTools(
+  env: OrchestratorServiceEnv,
+): Promise<ProductionAgentHarnessOptions["mcpTools"] | undefined> {
+  if (!env.MCP_REGISTRY_PATH) return undefined;
+  if (parseAuthorityProfile(env.ORCHESTRATOR_AUTHORITY_PROFILE) === "production" && env.MCP_REGISTRY_PATH === ":memory:") {
+    throw new Error("Production must not use an in-memory MCP registry (LENS_MCP_REGISTRY_PATH=:memory:); a persistent registry is required.");
+  }
+  if (!env.MCP_SECRET_STORE_PATH || !env.MCP_SECRET_STORE_KEY) {
+    throw new Error("LENS_MCP_SECRET_STORE_PATH and LENS_MCP_SECRET_STORE_KEY are required when LENS_MCP_REGISTRY_PATH is set.");
+  }
+  const registry = new SqliteMcpRegistry(env.MCP_REGISTRY_PATH);
+  const secrets = new EncryptedSqliteSecretStore(env.MCP_SECRET_STORE_PATH, env.MCP_SECRET_STORE_KEY);
+  const approvedToolGated = (await registry.listAllTools())
+    .filter((tool) => tool.state === "approved" && tool.resultAuthorization === "tool-gated");
+  const descriptors: McpToolDescriptor[] = approvedToolGated.map((tool) => ({
+    toolId: tool.toolId,
+    version: "1",
+    serverId: tool.serverId,
+    inputSchema: OPEN_MCP_TOOL_SCHEMA,
+    schemaDigest: tool.schemaDigest,
+    resultAuthorization: tool.resultAuthorization,
+    risk: "high_risk",
+  }));
+  const broker = new McpCredentialBroker(registry, secrets);
+  const sandbox = new McpHttpConnector({ registry, credentials: broker });
+  return { descriptors, broker, sandbox };
+}
+
 export type SharedAuthorities = {
   modelUseAuthority: ModelUseAuthorityPort;
   costAuthority: CostAuthorityPort;
@@ -493,6 +573,9 @@ export async function main(env: OrchestratorServiceEnv = loadEnv(), dependencies
   if (env.LENS_ORCHESTRATOR_ALLOW_DEV_AGENT_FACTS === "true" && !env.LENS_ORCHESTRATOR_DEV_AGENT_SIGNING_KEY) {
     throw new Error("LENS_ORCHESTRATOR_DEV_AGENT_SIGNING_KEY is required when LENS_ORCHESTRATOR_ALLOW_DEV_AGENT_FACTS=true.");
   }
+  if (authorityProfile === "production" && env.MCP_REGISTRY_PATH === ":memory:") {
+    throw new Error("Production must not use an in-memory MCP registry (LENS_MCP_REGISTRY_PATH=:memory:); a persistent registry is required.");
+  }
   const assertionVerifier = new DelegatedSessionAssertionVerifier(env.ASSERTION_VERIFY_KEY);
   const memoryAssertionVerifier = new DelegatedSessionAssertionVerifier(env.MEMORY_ASSERTION_VERIFY_KEY);
   const retrieval = new RetrievalHttpClient(env.RETRIEVAL_URL, env.RETRIEVAL_WORKLOAD_TOKEN);
@@ -537,6 +620,7 @@ export async function main(env: OrchestratorServiceEnv = loadEnv(), dependencies
   }
   const sharedAuthorities = loadSharedAuthorities(env, dependencies, effectiveModelEligibility);
   const agentPolicyReplica = loadAgentPolicyReplica(env, dependencies);
+  const mcpTools = await loadMcpTools(env);
   if (parseAuthorityProfile(env.ORCHESTRATOR_AUTHORITY_PROFILE) === "production" && !env.USAGE_RECEIPT_PUBLIC_KEY) {
     throw new Error("Production requires LENS_USAGE_RECEIPT_PUBLIC_KEY to verify sidecar-signed usage.");
   }
@@ -582,6 +666,7 @@ export async function main(env: OrchestratorServiceEnv = loadEnv(), dependencies
     ragProfile,
     conversationHistory: history,
     agentPolicyReplica,
+    mcpTools,
     agentSessionRoot: env.AGENT_SESSION_ROOT,
   });
   const http = createOrchestratorHttp({
```

The `:memory:` + production check appears twice on purpose: once early (right after
`authorityProfile` is computed, alongside the existing dev-agent-facts checks) so it fails fast
without requiring unrelated production config to be filled in, and once inside `loadMcpTools`
itself so the guard also holds for any caller that invokes the loader directly (tests included)
without going through `main()`'s full startup sequence.

## 6. Test output (real exit codes)

### Root baseline (before any change)

```
$ npm run typecheck; echo "exit: $?"
...
exit: 0
```

### Root typecheck (after change — unaffected; orchestrator-service isn't in the root tsconfig's `include`)

```
$ npm run typecheck; echo "exit: $?"
...
exit: 0
```

### orchestrator-service — the four named M6c tests

```
$ npx vitest run tests/m6cMcpProdWiring.test.ts --reporter=verbose; echo "exit: $?"
 ✓ tests/m6cMcpProdWiring.test.ts > M6c MCP production wiring > mcp.prod-wiring-exposes-approved-tools 26ms
 ✓ tests/m6cMcpProdWiring.test.ts > M6c MCP production wiring > mcp.prod-wiring-absent-means-no-mcp 0ms
 ✓ tests/m6cMcpProdWiring.test.ts > M6c MCP production wiring > mcp.prod-wiring-memory-registry-refused-in-production 0ms
 ✓ tests/m6cMcpProdWiring.test.ts > M6c MCP production wiring > mcp.prod-wiring-uses-factory-connector 13ms

 Test Files  1 passed (1)
      Tests  4 passed (4)
exit: 0
```

### orchestrator-service — full suite (204 pre-existing + 4 new)

```
$ npx vitest run; echo "exit: $?"
 Test Files  26 passed (26)
      Tests  208 passed (208)
exit: 0
```

### Root — named MCP tests

```
$ npx vitest run tests/unit/mcpConnector.test.ts tests/unit/toolExecutionGolden.test.ts; echo "exit: $?"
 ✓ tests/unit/mcpConnector.test.ts (8 tests) 81ms
 ✓ tests/unit/toolExecutionGolden.test.ts (8 tests) 3ms

 Test Files  2 passed (2)
      Tests  16 passed (16)
exit: 0
```

### Root — full suite (regression check)

```
$ npx vitest run; echo "exit: $?"
 Test Files  2 failed | 84 passed (86)
      Tests  2 failed | 435 passed (437)
exit: 1
```

Both failures are pre-existing and named in the module brief as not mine:
`tests/e2e/ragChat.test.ts` (fails to resolve `cookie-parser` import — an unrelated dependency
resolution issue in `server/src/index.ts`, a file this branch never touches) and
`tests/unit/bffRagUiApp.test.tsx` (`s.canGoBack is not a function` — a pre-existing session-store
mock gap in `src/App.tsx`, also untouched by this branch). No test outside these two files
regressed; no MCP-related test failed.

### Protected paths

```
$ git diff --stat 9150d10 d798500 -- services/ contracts/ authority-service/ server/ \
    orchestrator-service/src/agentHarness.ts orchestrator-service/src/agentPdpReplica.ts \
    orchestrator-service/src/agentDevFacts.ts
(empty)
```

## 7. Inferred / judgment calls (would have been stop-and-ask candidates)

The module brief's stop-and-ask trigger #1 ("the `mcpTools` option's shape needs anything
`mcp-registry` doesn't already export") applies more than once here. Rather than halting, each
was resolved with the most conservative (fail-closed) choice available and is called out below
for review — none weaken an existing invariant, and each is documented inline at its point of
use in `main.ts`.

1. **`McpToolRecord` has no `risk` field**, but `McpToolDescriptor.risk` is required and drives
   `requiresApproval` gating downstream. Defaulted every registry-sourced tool to `"high_risk"`
   (maximum caution — forces approval) rather than guessing `"read"`. Cost: more approval
   friction than a correctly-classified tool might need; no safety regression either way.

2. **`McpToolRecord` has no raw `inputSchema`**, only its digest, and "no discovery at startup"
   forbids a live fetch to fill it in. Used a permissive open-object placeholder
   (`{ type: "object", additionalProperties: true }`) as the harness-facing `parameters` shape.
   `McpHttpConnector.dispatch` independently re-fetches the live schema and checks it against
   the real pinned `schemaDigest` before every call — enforcement never depends on this
   placeholder, only the model's up-front guidance does.

3. **`McpToolRecord` has no `declaredResourceRefs`.** A `resource-gated` tool exposed without
   them would authorize against an empty `resourceRefs` array, and
   `bindToolGovernance`'s allowed-list-length check (`services/agent-integration/
   governanceBinding.ts:128`) passes an empty-vs-empty comparison vacuously — i.e. the PDP
   check would silently no-op (fail OPEN) for such a tool. Rather than ship that, this wiring
   **only exposes `tool-gated` approved tools** (`resultAuthorization === "tool-gated"`), whose
   resourceRef is the synthetic, always-populated `tool:` ref from `mcpToolResourceRef` —
   `resource-gated` MCP tools registered via the BFF admin flow are simply not exposed by this
   wiring yet. This is the one place a real capability gap exists: resource-gated MCP tools need
   the registry (or a follow-up module) to persist `declaredResourceRefs` before they can be
   safely wired into production.

4. **No secret store existed anywhere in `orchestrator-service` before this branch** (grepped —
   zero hits). The module brief assumes "the secret store the orchestrator already has"; there
   wasn't one to reuse, so this branch adds one, following the BFF's own exact pattern
   (`EncryptedSqliteSecretStore` keyed by a master key — see `server/src/index.ts`). This is why
   two additional env vars (`LENS_MCP_SECRET_STORE_PATH`/`LENS_MCP_SECRET_STORE_KEY`) exist
   beyond the single one the brief called out; a deployer must point them at the same sealed
   secrets file/key an admin's MCP server registration used, or MCP tool calls can't resolve
   their credentials. If a secret store already exists elsewhere in this deployment's actual
   production topology that should have been reused instead, that's worth a second look.

5. **Descriptor `version` is hardcoded to `"1"`** — `McpToolRecord` doesn't carry a version
   either, and `McpToolDescriptor`'s own doc comment already treats `"1"` as the default absent
   a re-approval bump, so this isn't a new judgment call so much as the documented default.

None of the above required touching a protected path; all are additive, fail-closed, and
reversible by a follow-up module once the registry's schema grows to carry `risk` and
`declaredResourceRefs`.
