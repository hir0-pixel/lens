# M6 — MCP Tools as Governed Backends

**Phase 1.5. Requires M5 merged (`0f2a8d9` or later). Two sub-modules, sequential.**

Prerequisite: read `00-START-HERE.md`. This module assumes M0–M5 are in
`main` and you have read `orchestrator-service/src/agentHarness.ts` in full —
it is the canonical construction site every tool now plugs into.

---

## 1. Requirements

### Functional

- An **admin** registers an MCP server server-side. Never from the browser,
  never from the model, never from a request body an employee controls.
- The platform **discovers** the server's tools, computes a schema digest for
  each, and the admin **approves a subset**. Unapproved tools do not exist as
  far as the agent is concerned.
- Each approved tool becomes a **catalog entry** the agent can call through
  the same path as `search_corpus`: M1 authorises it, M4 filters its result.
- MCP tool results carry **provenance** so M4 can decide whether their content
  reaches the model.
- MCP **credentials** are issued per call, bound to the execution fence, and
  never present in the agent process.

### Non-functional

| Property | Requirement |
|---|---|
| Sovereignty | HTTP transport only, to endpoints inside the deployment or explicitly approved. **No stdio.** Spawning a process is code execution and belongs in the `microvm` isolation class (ADR-015-004) — Phase 2 |
| Fail-closed | Unknown tool, schema drift, unreachable server, missing provenance, credential failure → the call is blocked or its result withheld. Never degraded |
| Isolation | MCP servers are **untrusted content sources**, same threat class as uploaded documents (ADR-015-005). Results are bounded, never logged raw, and never reach the model unfiltered |
| Concurrency | 50 concurrent runs (M0's proven envelope); no per-server state shared across runs |
| Latency | One MCP call must complete inside the M1 deadline or block. No retries that extend past `deadlineAt` |

## 2. Estimation

Enterprise deployment, sized honestly:

| Quantity | Estimate |
|---|---|
| MCP servers per company | 5–20 |
| Approved tools | 50–200 |
| Tool calls per agent run | 5–20 |
| Concurrent runs (peak) | 50 |
| MCP call rate | 50 runs × 10 calls ÷ ~60 s ≈ **8 calls/s peak** |
| Registry storage | 200 tools × ~2 KB ≈ 400 KB |
| MCP HTTP round-trip | 50–500 ms |

**Consequence:** no queue, no cache, no sharding. At 8 calls/s the bottleneck
is the MCP server, not us. A registry row per tool in the existing durable
store is sufficient. Introduce a block only when its bottleneck appears.

## 3. High-level design

```
Admin (SSO, ADMIN_SUBJECTS)
  └─ POST /api/admin/mcp-servers        BFF, requireAdmin, CSRF
       └─ MCP registry                  durable; stores endpoint, secret_ref, approved tools + digests
            └─ discovery                lists tools, digests schemas, awaits admin approval
                 └─ catalog             AgentRuntime.registerTool + ToolExecution catalog, one entry each

Agent run (orchestrator-service, canonical harness)
  model proposes call
    └─ before_tool ── M1: PDP gate, resolveIntent from dispatch table, fence consumed
         └─ envelope: reserveStep / start
              └─ MCP tool wrapper (AgentHarnessTool)
                   └─ ToolExecutionService.execute
                        ├─ CredentialBroker.issue  → credentialRef bound to fence   (orchestrator never sees the secret)
                        └─ Sandbox.dispatch        → MCP HTTP connector resolves ref, calls server, bounds result
                   └─ wrapper attaches details: { resourceRefs, provenance }
         └─ after_tool ── M1: finalize + audit
    └─ transform_context ── M4: decideBatch on refs, withhold or keep
    └─ model gateway
```

Every box after "model proposes call" already exists except the registry, the
connector, the wrapper, and the dispatch-table entries. Nothing in M1, M4, or
the harness changes.

## 4. Deep dive — the three hard parts

### 4a. Credentials never enter the agent process

`services/tool-execution/ToolExecutionService.ts` already defines the seam:

```ts
CredentialBroker.issue({ subjectRef, targetRef, action, executionFence }) → { credentialRef }
Sandbox.dispatch({ targetRef, action, credentialRef, executionFence, idempotencyKey, argumentsDigest })
```

The **MCP HTTP connector is a `Sandbox` implementation.** It receives a
`credentialRef`, resolves it inside the connector, makes the call, and returns.
The orchestrator holds a ref, not a secret. `assertAgentEnvironment` (M2)
continues to pass.

**One additive extension required:** `Sandbox.dispatch` returns only
`{ status }` because it was built for side-effect tools. MCP tools return data.
Add an optional `result?: { content: string; resourceRefs: readonly string[] }`
to the return type — additive, bounded (`maxOutputBytes`, same as M3), and
optional so every existing implementation is untouched.

### 4b. Schema pinning — drift is a security event

MCP servers can change a tool's schema at runtime. A tool that was approved
with one input shape and now accepts another is a different tool.

- On approval, store `schemaDigest = sha256(canonical JSON of the tool's input schema)`.
- On **every call**, the connector re-fetches or caches-with-TTL the live
  schema, recomputes the digest, and compares. **Mismatch → the call is blocked
  and the tool is marked `drifted` in the registry.** It stays unusable until
  an admin re-approves against the new schema.
- The catalog entry's `schemaDigest` is what M1's `intentDigest` is derived
  against, so a drifted tool cannot produce a fence-valid intent.

This will break tools on server upgrades. That is the correct behaviour for a
sovereign platform. The mitigation is an admin re-approval flow that shows the
schema diff — not a looser check.

### 4c. Provenance — how MCP results pass M4 without changing M4

M4's rule: a tool result reaches the model only if `details.resourceRefs` is
non-empty and every ref is PDP-allowed. A weather tool has no document refs.
Under the rule as written, its result is withheld. That is wrong — the
employee was authorised to call the tool, and the result *is* the tool's
authorised output.

**Resolution — synthetic tool refs, no M4 change.** Each MCP tool's catalog
entry declares a `resultAuthorization` mode:

| Mode | Wrapper sets `details.resourceRefs` to | M4 asks the PDP |
|---|---|---|
| `tool-gated` | `["tool:<toolId>@<version>"]` — one synthetic ref naming the tool itself | "may this subject use this tool?" — the same question M1 answered |
| `resource-gated` | Refs the connector extracted from the result, per a declared JSON path | "may this subject see these resources?" — same as `search_corpus` |

The PDP replica's `FactReaders.resources` learns to resolve `tool:` refs: the
resource exists, is published, and `aclAllows` iff the subject holds the tool
grant. M4 is unchanged. The PDP stays the single authority on what reaches the
model. The redundancy with M1 is deliberate — it means a future tool that
bypasses M1 still cannot reach the model.

`resource-gated` is for tools that return company data (a CRM, a ticket
system). Their catalog entry names the JSON path where resource refs live in
the result. If the path is absent or empty → `resourceRefs: []` → M4 withholds.
An MCP server that returns company data without provenance gets nothing to the
model. That is fail-closed and it is the point.

## 5. Tradeoffs

| Choice | Cost | Why we accept it |
|---|---|---|
| HTTP-only, no stdio | Excludes most community MCP servers | Stdio is code execution; a sovereign deployment runs MCP servers as internal services anyway |
| Schema pinning | Tools break on server upgrade until re-approved | A silently-changed tool is a different tool. Loud beats silent |
| Synthetic `tool:` refs | PDP checks the tool grant twice (M1, M4) | Keeps M4 unchanged and the PDP the only authority. Redundancy is cheap |
| Credentials via broker | One extra hop per call | It's Doc 014's design and it's already in code |
| No cache, no queue | None at this scale | 8 calls/s. Add when a profiler says so |

## 6. Reliability and operations

**Failure modes** — every one fails closed:

| Failure | Behaviour |
|---|---|
| MCP server unreachable | `DEPENDENCY_UNAVAILABLE` from the connector → M1 sees the tool throw → block. Run continues or terminates per envelope |
| Schema drift | Block; tool marked `drifted`; admin notified |
| Credential issue fails | Block. Never retry with a cached credential |
| Result exceeds `maxOutputBytes` | Truncate with a marker, as M3 does. Never split into a second call |
| Result lacks provenance (`resource-gated`) | `resourceRefs: []` → M4 withholds |
| Call exceeds `deadlineAt` | Abort via the signal M1 already threads through; block |

**Health:** the registry's connection manager probes each server on an
interval. An unhealthy server's tools are marked `unavailable` in the catalog;
calls to them block immediately without a network attempt.

**Metrics** (through the existing log ports, counts only — never arguments,
never results): calls per tool, latency p50/p99 per server, error rate per
server, `drifted` events, `unavailable` transitions, withheld-by-provenance
count.

**Deployment:** the registry is durable state and follows the same rule as
everything else in Lens — SQLite for local, Postgres for multi-replica.
Registry changes are admin actions and are audited like provider onboarding.

## 7. Quick Diagnostic self-score

| Row | Pass? |
|---|---|
| Requirements listed | Yes — §1 |
| QPS and storage estimate | Yes — §2 |
| Every component redundant | **Partial** — MCP servers are external; their redundancy is the deployer's. The connector is stateless and scales with orchestrator replicas |
| DB scaling strategy | Yes — same as the rest of Lens; 400 KB doesn't need one |
| Cache for read-heavy paths | **Deliberately no** — 8 calls/s; schema cache-with-TTL is the only one |
| Async via queues | **Deliberately no** — calls are synchronous inside a deadline by design; a queue would break the fence model |
| Monitoring plan | Yes — §6 |
| Deployment strategy | Yes — §6 |

**6/8 → 8/10.** The two "no" rows are considered and correct at this scale;
they are documented here so nobody adds them reflexively later.

---

## M6a — Registry, connector, schema pinning. No agent wiring.

**Goal:** an admin can register an HTTP MCP server, approve tools, and the
connector can call them with brokered credentials — proven against a local
stub MCP server, without touching the harness.

**Ships:**
- Durable MCP registry: server `id`, `endpoint`, `secret_ref`, transport
  (`http` only — reject anything else), approved tools with `schemaDigest`,
  `resultAuthorization` mode, optional provenance JSON path, `state` ∈
  `{ approved, drifted, unavailable, disabled }`
- `POST /api/admin/mcp-servers` and approval routes on the BFF, `requireAdmin`,
  CSRF, same shape as `server/src/routes/providers.ts`. Response bodies contain
  `{ id, state }` — never the endpoint, never `secret_ref`
- MCP HTTP connector implementing `Sandbox` with the additive `result` field;
  resolves `credentialRef` internally; enforces `maxOutputBytes`; recomputes
  and compares schema digest per call
- Health probe and `unavailable` marking
- A **stub MCP server** under `tests/` that serves two tools — one that returns
  plain data, one that returns data with resource refs — and can be told to
  change a schema mid-test

**Holds:**
- `mcp.admin-only` — non-admin and unauthenticated registration → 403
- `mcp.no-secret-in-responses` — no admin or catalog response contains
  `endpoint` or `secret_ref` (same marker scan M0's Task 9 smoke used)
- `mcp.http-only` — a `stdio` or unknown transport is rejected at registration
- `mcp.credential-never-in-process` — during a connector call, scan the
  orchestrator process env and the connector's call arguments; the secret
  value appears in neither. Only `credentialRef` does
- **`mcp.schema-drift-blocks`** — approve a tool, change its schema on the
  stub, call it → blocked, registry state `drifted`, no request reached the
  stub's tool handler
- `mcp.unreachable-fails-closed` — stub down → `DEPENDENCY_UNAVAILABLE`, no
  retry past deadline
- `mcp.result-bounded` — oversized result truncated with marker; never a second
  call
- `mcp.unapproved-tool-absent` — a discovered-but-unapproved tool is not in
  the catalog and cannot be called
- G1, G2, G5, G7, G8 re-verified

**Untouched:**
```
services/pdp/**   services/retrieval/**   services/agent-runtime/**   contracts/**
services/agent-integration/**             orchestrator-service/src/agentHarness.ts
services/secrets/**                        server/src/routes/providers.ts
```
`services/tool-execution/` is **unprotected for the additive `result` field
only.** Existing `execute`, `CredentialBroker`, and `Sandbox.dispatch` inputs
are byte-identical — golden test required.

**Review packet:** diff; protected-path diff (empty); `tool-execution` diff
showing additions only plus the golden test; full output of every named test;
a captured connector call showing `credentialRef` in the arguments and the
secret value absent; the schema-drift test output showing the block and the
state transition.

---

## M6b — Harness wrapper, dispatch table, provenance, M4 flow-through.

**Goal:** an approved MCP tool is callable by the agent on the same rails as
`search_corpus`, and its result reaches — or is withheld from — the model
according to its `resultAuthorization` mode. **Requires M6a signed off.**

**Ships:**
- `createMcpTool(entry)` — an `AgentHarnessTool` factory per approved catalog
  entry, following `corpusTool.ts`: bounded output, `details` carrying
  `resourceRefs` per mode, no raw logging
- `AgentRuntime.ToolCatalogEntry` per tool with real `sha256:` digests, `risk`
  from the admin's approval (`read` or `reversible_write`; `high_risk` requires
  `requiresApproval: true`), registered at the canonical construction site
- **`resolveIntent` dispatch table** in `agentHarness.ts` — extended, not
  replaced: `search_corpus` → M3's resolver; each MCP tool →
  `{ action: "agent.tool.mcp.<toolId>", resourceRefs: ["tool:<toolId>@<version>"] }`
  for `tool-gated`, or the declared corpus/resource refs for `resource-gated`.
  Unknown tool name → throw → block (already tested in M5)
- `FactReaders.resources` in `agentPdpReplica.ts` resolves `tool:` refs:
  published, integrity-valid, `aclAllows` iff the subject holds the grant
- Provenance extraction per the entry's JSON path for `resource-gated` tools

**Holds:**
- **`mcp.tool-gated-reaches-model`** — a `tool-gated` tool the subject may use:
  result content is present in the captured model payload
- **`mcp.tool-gated-withheld-without-grant`** — same tool, subject lacks the
  grant: M1 blocks; and if forced past M1 in the test, M4 withholds. Both
  layers proven independently
- **`mcp.resource-gated-filtered`** — a `resource-gated` tool returning refs of
  mixed entitlement: only allowed content reaches the model; the rest is the
  `[withheld]` stub with `toolCallId` preserved
- `mcp.resource-gated-no-provenance-withheld` — result without the declared
  path → `resourceRefs: []` → withheld
- `mcp.every-call-decided` — over a run mixing `search_corpus` and MCP calls,
  executions equal consumed fences (M1's invariant, re-proven with the new
  dispatch)
- `mcp.drifted-tool-blocked-at-harness` — a `drifted` entry is blocked by M1
  before any connector call
- `mcp.concurrent-isolation` — two subjects, different tool grants,
  concurrent; neither sees the other's results. Ten sessions as well
- `routing.default-off` and `routing.agent-path-still-gated` — re-run unchanged;
  regression guard
- `transcript-stays-valid` — M4's pairing invariant holds with MCP results

**Manual:**
- Register a real internal HTTP MCP server (not the stub). Approve one tool.
  Run a task that uses it. See `decision_requested → fence_consumed →
  tool_completed` in the audit log
- Revoke the subject's grant. Re-run. See the block
- Change the tool's schema on the server. Re-run. See `drifted` and the block
- Confirm the audit log contains tool names and counts only — never arguments,
  never results

**Untouched:**
```
services/pdp/**   services/retrieval/**   services/agent-runtime/**   contracts/**
services/agent-integration/governanceBinding.ts
services/agent-integration/contextBinding.ts
services/agent-integration/corpusTool.ts
services/agent-integration/modelTransport.ts
services/agent-integration/compactionBinding.ts
```
`agentHarness.ts` and `agentPdpReplica.ts` are **unprotected for additive
changes**: new dispatch-table entries, new `tool:` resolver branch, new
catalog registrations. The existing `search_corpus` path and the binding order
established in M5 are byte-identical — golden test on the `stops` array order.

**Stop-and-ask:** if M4's rule needs to change to make any of this work, stop.
The synthetic-ref design exists precisely so it doesn't. If a real MCP server
you're testing against needs stdio, stop — that's Phase 2.

**Review packet:** diff; protected-path diff (empty); the dispatch table in
full; the `tool:` resolver in full; captured model payloads for the
`tool-gated` allowed case and the `resource-gated` mixed case; audit-log
excerpt from the manual revoke-and-rerun.

---

## What M6 does not do

- **Skills.** Signed, versioned instruction bundles selecting system prompt,
  allowed catalog IDs, and envelope defaults — chosen at the construction
  site. A skill grants no authority. Separate module; not before M6 lands.
- **Stdio MCP servers.** Phase 2, behind the `microvm` isolation class.
- **Dynamic tool exposure.** Every tool the agent can see was approved by a
  human against a pinned schema. Discovery informs the admin; it never
  informs the model.
