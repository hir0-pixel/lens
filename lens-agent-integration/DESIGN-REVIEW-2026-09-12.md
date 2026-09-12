# Design Review — Scalability, Privacy, Accessibility, UX

**Date:** 2026-09-12
**Scope:** `lens-agent-integration/` M0–M7 (Prime Agent harness + MCP tool integration) reconciled against the 25-document architectural baseline at `/Volumes/hir0-ssd/Lens/`, plus a fresh look at `src/` for the accessibility and UX lenses.
**Method:** the four-step system-design framework (requirements → high-level design → deep dive → tradeoffs) applied per lens, scored against the eight-row Quick Diagnostic, with findings reconciled against the baseline by document and section number.
**Constraints honored:** no code changes; no proposal weakens or removes a control in `services/pdp`, `services/agent-integration`, or the audit ledger; every finding names a landing site; every pattern names its source; ADR impact is called out explicitly where it exists.

---

## 0. What was read

Baseline: `001` in full; `002, 004, 005, 009, 012, 013, 016, 018, 021, 022, 023, 025` in full; `architecture-audit-2026-08-10.md` and `security-architecture-audit-2026-08-13.md` in full (both are historical, remediated point-in-time reports — their resolution notes say the findings were closed at the contract level in the numbered documents; this review does not re-raise a settled item unless the agent/MCP surface reopens it on a *new* component the original audit could not have seen).

Agent integration: `00-START-HERE.md`, `01-M0-vendor.md`, `02-M1-governance-binding.md`, `07-M6-mcp-tools.md`, `09-M7-dev-agent-facts.md`, `11-REDUNDANCY-AUDIT.md`, and the review packets for `M1, M3, M4, M5, M6A` (no `M6B`/`M6C` packet exists yet, consistent with the instruction to read them only if present).

Code: `orchestrator-service/src/agentHarness.ts`, `agentPdpReplica.ts`, `services/pdp/PolicyDecisionPoint.ts`, `services/agent-integration/*`, `server/src/rag/orchestratorClient.ts`, `orchestrator-service/src/http.ts`, `server/src/routes/api.ts`, and the frontend chat/agent surface under `src/components/ai/`, `src/features/employee-chat/`, `DESIGN-lens.md`.

Not read (see §6, "what I couldn't complete"): `08-INTEGRATION-TEST-GUIDE.md`, `agent-run-authority-service/`, `authority-service/` in depth, `delivery/`, and the remaining ~13 baseline documents not named by the spec for any of the four lenses.

---

## 1. Baseline reconciliation

### 1.1 Scalability — what the 25 docs already decide

- Doc 001 §8/§17/§21: capacity is inference-native, not GPU-count-based; Phase 2 floor is **1,300 concurrent generating requests**, **≥43 route-classification starts/s**, **≥43 final-generation starts/s**, **≥86 total model-step admissions/s**. Every subsystem sizes against one signed `DeploymentCapacityProfile`.
- Doc 004 §15: Orchestrator is stateless; 2,000 concurrent active workflows is the acceptance floor; ADR-004-001 — "loss of a replica loses a socket/attempt, not authoritative turn or tool state."
- Doc 013 §Normative v6.1 (ADR-SCHED-011): `rag-route-classification` gets its own reserved, separately sized bulkhead so router load can never starve final generation or vice versa — and explicitly, "an unmeasured router profile is not admissible capacity."
- Doc 009 / Doc 012: KV-cache and runtime execution are Inference Pool's problem, not a platform-wide cache; protected generated/semantic caching stays disabled (ADR-CACHE-004).
- Doc 022 §5.1: a state-class placement inventory names every stateful owner in the platform (sessions, subject/policy heads, conversation turns, model metadata, agent/tool/budget ledgers, Scheduler reservations, audit, secrets, document bytes, caches/telemetry, event bus/outboxes) with its synchronous authority and DR/rebuild rule.
- Already settled by the August audits and not re-raised here: Scheduler's atomic lease/fence/reservation state machine (2026-08-10 H-03) — now fully specified in Doc 013 §9–§10 and ADR-SCHED-006; Audit's HA/partitioning/quorum design (2026-08-10 C-06/C-07) — now Doc 021 §6, §10, and the 20,000 events/s floor; durable conversation-write ordering (2026-08-10 H-02) — now `CONVERSATION-COMMIT`.

**What the baseline could not have decided:** M0–M7 postdate all of this. Doc 022 §5.1's state-class table has no row for agent-harness session transcripts or in-process PDP-replica fence state, because those components didn't exist when it was written. That silence is not a decision; it's a gap this review is obligated to close (§2.1, F-S1/F-S2).

### 1.2 Privacy — what the 25 docs already decide

- Doc 005: live authorization only, no cached final decisions (ADR-005-001/002), operation-bound single-use decision fences (ADR-005-004) — "not a reusable token and not a replay stream."
- Doc 016: preservation is orthogonal to access (ADR-016-003, closing the 2026-08-10 C-08 finding); derived output gets its own classification and cumulative-exposure ledger before disclosure (Security Hardening v3, closing 2026-08-13 SEC-C03).
- Doc 021: audit is content-free by construction (§5 write contract — "content, prompts, outputs and raw tool arguments are never inline"); this is the platform-wide instance of the `[withheld]` / counts-only pattern the M-doc series (M1, M4) correctly reuses for the agent path.
- Doc 023 §14 / `TRANSITIVE-TOOL-EGRESS`: every Doc 014 tool target needs a reviewed data-flow profile (external-delivery capability, recipient domain, DLP) before it can carry protected data — this closes 2026-08-13 SEC-C05 ("internal tool target can be an external relay") for the tool targets that existed in August.
- Doc 018 §12 (Normative v7, 2026-08-23): three new red-team campaign families — router-manipulation, adapter/runtime-boundary, attempt-durability — added specifically because the runtime-adapter and adaptive-RAG work introduced new attack surface the original red-team scope didn't cover.
- Already settled, not re-raised: SEC-C01 (no universal PAM) — closed by Doc 025 §16; SEC-C06 (self-grant) — closed by Doc 002 ADR-002-008 / Doc 016 §11; SEC-C04 (supply chain) — closed by Doc 024's secure-delivery ownership (referenced throughout, not separately re-verified here since it isn't one of the lens's named docs).

**What the baseline could not have decided:** MCP servers are a *new* tool-target class, registered after Doc 023 §14 and the Doc 018 §12 campaign families were written. The pattern that closed SEC-C05 and added the router/adapter red-team coverage has to be re-applied to this new class by hand — it doesn't inherit automatically just because the pattern exists elsewhere (§2.2, F-P2/F-P4).

### 1.3 Accessibility — what the 25 docs already decide

Nothing. Grep and read confirm zero mentions of WCAG, screen readers, keyboard navigation, contrast, or `aria-*` anywhere across all 25 documents, both August audits, and every reconciliation report. Doc 001 §10's "Cross-Cutting Requirements (binding on every subsystem document)" lists eleven binding obligations — authentication, audit logging, metrics/SLOs, failure mode, backup/DR, zero-egress, capacity, latency budget, failure-domain placement, SLO/error-budget, and N/N-1 compatibility. Perceivability is not among them, for any subsystem with a UI. **This is finding #1, exactly as the spec anticipates, and it is a baseline gap, not an agent-integration gap** — it predates M0 entirely.

### 1.4 UX — what the 25 docs already decide

The 25 docs are architecture, not product; they define the request/data flows an employee-facing surface must respect (grounding-required enforcement, `no_context` non-enumeration, buffered/release-gated output, `INCOMPLETE`/`DENIED` as first-class terminal states at the API layer — Doc 004 §7, §23) but never prescribe how any of that is *shown*. The one place product intent leaks into the numbered docs is Doc 004's `AgentHarnessResult`-shaped terminal states (`COMPLETED | INCOMPLETE | DENIED`, carried end-to-end through `orchestrator-service/src/http.ts` and `server/src/rag/orchestratorClient.ts`) — the backend contract for exactly the UX problem named below already exists and is unused.

---

## 2. Per-lens analysis

### 2.1 Scalability

**Requirements.**
Functional: an employee-assigned multi-step task completes within the same PDP/audit/release-gate discipline as one-shot RAG, at the concurrency the platform already promises (Doc 001 §8: 1,300 concurrent generating requests at Phase 2). Non-functional, from `07-M6-mcp-tools.md` §1: fail-closed on unknown tool/schema drift/unreachable server; one MCP call finishes inside the M1 deadline or blocks, no retry past `deadlineAt`; no per-server state shared across runs. No SLA numbers are stated anywhere in the agent-integration docs beyond "50 concurrent runs (M0's proven envelope)" and "8 calls/s peak" for MCP — see F-S4 below for why that number is not, in fact, proven.

**Estimation.**
`07-M6-mcp-tools.md` §2 gives MCP-specific numbers (5–20 servers/company, 50–200 approved tools, 8 calls/s peak, 400 KB registry). It does **not** estimate the model-step load a multi-step agent run adds on top of ordinary auto-RAG's already-tight 2-step (route + final) floor. `orchestrator-service/src/agentHarness.ts:50-51` sets `DEFAULT_MAX_STEPS = 4` and `DEFAULT_MAX_COST_UNITS = 16_384` — an agent run can dispatch up to 4 model steps, each requiring its own `AuthorizeModelUse`, Scheduler reservation, and Doc 014 step fence (Doc 004 §11). At 50 concurrent runs × up to 4 steps, that is up to 200 model-step admissions/s from agent traffic alone — never estimated against Doc 013's 86/s Phase-2 floor, which was sized only for the ordinary auto-RAG two-step case.

**Quick Diagnostic — Scalability: 6/10**

| Row | Pass? | Evidence |
|---|---|---|
| Requirements listed (functional + NFR, with SLAs) | Pass | `07-M6-mcp-tools.md` §1; Doc 001 §8 Phase targets apply by inheritance |
| QPS/storage estimated with numbers | Partial | MCP call rate and registry size are estimated (§2); agent multi-step model-dispatch load is not, and is not reconciled against Doc 013's 86/s floor |
| Every component redundant | Fail | `PolicyDecisionPoint.consumedFences` (`services/pdp/PolicyDecisionPoint.ts:23`) and `admittedRuns` (`orchestrator-service/src/agentHarness.ts:169`) are in-process `Set`/`Map`; sessions are local JSONL files (`agentHarness.ts:469`) — none survive a replica restart or are shared across replicas |
| DB scaling strategy stated | Partial | MCP registry follows the established SQLite-local/Postgres-production pattern (M6A packet §8, item 1); agent session/run state has no such stated path |
| Cache for read-heavy paths | Pass (deliberate no) | `07-M6-mcp-tools.md` §7: "8 calls/s. Add when a profiler says so" — reasoned and written down |
| Async via queues | Pass (deliberate no) | Same doc: "a queue would break the fence model" — correct, because the M1 tool-boundary fence is deadline-bound |
| Monitoring and alerting | Partial | Per-tool/per-server metrics are named (§6); no SLO or `SLO-ERROR-BUDGET`-style threshold is defined for the new failure classes (schema drift, cross-replica fence loss) |
| Deployment strategy | Fail | No module document describes a rollout/canary or a migration path for the session store; M7 talks about dev-stack wiring only |

**Findings:** F-S1, F-S2, F-S3, F-S4 (detail in §3).

### 2.2 Privacy

**Requirements.**
Every new data flow the agent adds — tool call arguments, tool results, MCP server responses, session transcripts — must reach the same bar the one-shot RAG path already holds: PDP-gated before it reaches the model, content-free in telemetry, and audit-admitted before disclosure (Doc 021 §5; Doc 001 principle 7). `/refine`-style self-modification is explicitly not yet enabled per the task brief, so it is out of scope for this pass and not re-raised.

**Estimation.**
Doc 016's exposure ledger and Doc 021's audit floor (1,300 concurrent output classifications/s, 20,000 committed events/s) already account for one-shot RAG at Phase 2. Nothing in the agent-integration docs adds a volumetric estimate for agent-specific new artifacts: session-transcript bytes/day, MCP audit-event rate on top of the existing floor, or retention growth for either. This is a smaller gap than scalability's because the *volume* is bounded by the same 50-run/8-calls-per-second envelope already estimated — the gap is entirely about *where the data lands*, not how much of it there is.

**Quick Diagnostic — Privacy: 8/10**

| Row | Pass? | Evidence |
|---|---|---|
| Requirements listed | Pass | Doc 005/016/021/025 requirements are explicit and the agent docs correctly inherit them (M1, M4 review packets show fail-closed, content-free logs) |
| Volumes estimated | Partial | Output-classification and audit floors exist at baseline; agent-specific session/audit volume is not separately estimated |
| Every component redundant (for protected state) | Partial | PDP/Governance/Audit are fully quorum-redundant at baseline; the *new* session-file store and in-process PDP-replica fence state are not (see F-P1, shared root cause with F-S1/S2) |
| Data/governance ownership stated | Partial | Baseline's per-artifact ownership (Doc 016 §4) has no entry for agent session transcripts (F-P1) |
| Cache correctness for protected data | Pass | M6b's `tool:` synthetic-ref extension to `FactReaders.resources` (`agentPdpReplica.ts:96-123`) requires a fresh PDP decision on every read — correctly extends ADR-CACHE-001 rather than working around it |
| Audit-before-disclosure preserved | Pass | M1/M4/M6b all fence on `before_tool`/`after_tool`/`transform_context` before content reaches the model (governance/context binding review packets) |
| Monitoring for privacy signals | Pass | `context_filtered` counts-only log, `drifted` events, withheld-by-provenance counts (M4 packet, `07-M6-mcp-tools.md` §6) |
| Deployment/rollback for policy changes | Partial | M7's dev-facts flag has a clean, well-guarded rollout story; there's no equivalent statement for rolling back a bad MCP tool approval or a signed agent policy bundle in production |

**Findings:** F-P1, F-P2, F-P3 (cross-reference to F-S1), F-P4.

### 2.3 Accessibility

**Requirements.** WCAG 2.2 AA, because nothing narrower or wider is stated anywhere and AA is the conventional enterprise-procurement bar. Scope: keyboard reachability, focus visibility, contrast, screen-reader semantics for the chat transcript and citation UI, reduced-motion respect, and perceivability of agent-run terminal states.

**Estimation.** No formal count of components or violations exists anywhere in the product. This review sampled the chat/agent surface (`src/components/ai/*`, `src/features/employee-chat/*`) and the palette contract (`DESIGN-lens.md`) rather than running a full audit (see §6).

**Contrast — computed against `DESIGN-lens.md`, WCAG relative-luminance formula:**

| Pair | Ratio | AA (4.5:1 normal / 3:1 large) | AAA (7:1 normal) |
|---|---|---|---|
| `#5A5852` on `#F7F7F4` (light secondary text) | **6.63:1** | Pass | Fail, by 0.37 |
| `#9B9B9B` on `#141414` (dark secondary text) | **6.63:1** | Pass | Fail, by 0.37 |
| `#A09C92` on `#F7F7F4` (tertiary/placeholder — marked "inferred, ratify" in the palette doc) | **2.55:1** | **Fail** — below even the 3:1 large-text floor | Fail |

The first two pairs the spec named are fine for AA and close to AAA. The third — not named in the spec, found while computing the other two — is not fine, and it's not decorative: `AgentWorkflow.tsx` renders the tool name and duration timestamp in `text-[var(--text-tertiary)]`/`text-[var(--text-disabled)]`, i.e. real information at a contrast ratio screen-magnification and low-vision users will not reliably read.

**Quick Diagnostic — Accessibility: 2/10**

| Row | Pass? | Evidence |
|---|---|---|
| Requirements listed (WCAG target, SLAs) | Fail | No target stated anywhere in the 25 docs, the agent-integration set, or the repo |
| Scope estimated | Partial | Supplied by this review, not the product (see above) |
| Every interactive surface keyboard/focus-robust | Partial | Radix/shadcn primitives (`accordion`, `toggle`) are keyboard-accessible by library default; `--focus-ring-*` tokens exist (`src/index.css`) but are consumed in only 5 files platform-wide — not in `AIComposer`, `AIMessageBubble`, or `AgentWorkflow`'s accordion triggers, the actual chat/agent path |
| Terminal states announced to assistive tech | Fail | Zero `aria-live` in `src/components/ai/*` or `src/features/employee-chat/*`; `AgentWorkflow`'s "Thinking…" → "Agent is working…" → done transitions are spinner/text-only |
| Contrast sufficient for real content | Partial | Two named pairs pass AA; tertiary/placeholder text used for real content fails even the large-text floor |
| Reduced motion respected | Pass | Global `@media (prefers-reduced-motion: reduce)` block in `src/index.css:1338` covers all animations |
| Automated accessibility gate | Fail | No `axe`/`pa11y`/`lighthouse-ci` dependency anywhere in `package.json`; no CI workflow directory exists in the repo at all |
| Deployment gate for regressions | Fail | Same as above — nothing blocks a contrast or focus regression from shipping |

**Findings:** F-A1, F-A2, F-A3, F-A4, F-A5.

### 2.4 UX

**Requirements**, in the priority order the spec gives:
1. A way to assign a task, see it's agentic, watch its steps, and be told unambiguously when it finished incomplete or was denied — so nobody acts on a partial answer as complete.
2. An admin surface for MCP registration, tool approval, and schema-drift re-approval with a diff view.
3. The existing chat/RAG UX, reviewed fresh.

**Estimation.** No product-side estimate exists for how many employees would use agent mode, task frequency, or session length — there's no telemetry plan for it either (Doc 020 §TELEMETRY-DATA-MINIMIZATION would govern *what* such telemetry could contain, but nothing says whether it will exist).

**Quick Diagnostic — UX: 2/10**

| Row | Pass? | Evidence |
|---|---|---|
| Requirements listed | Partial | The spec's own three-item list is the closest thing to a requirements doc; no product spec exists in-repo |
| Scope/adoption estimated | Fail | No numbers anywhere |
| Works across input modes (keyboard, screen reader, mobile) | Fail | Follows directly from the accessibility findings above |
| State model complete | Fail | `EmployeeTurnState` (`src/features/employee-chat/turnState.ts`) has no `incomplete` value at all, and the file has zero importers anywhere in `src/` — the presentation contract was designed and then never wired to a component |
| Visual language reusable across surfaces | Partial | `AgentWorkflow.tsx`/`AgentPlanPanel.tsx` is a genuinely good "agent is working" pattern — but its category taxonomy (`read`, `write`, `edit`, `terminal`, `git`) is a coding-agent's, wired nowhere near the RAG/tool-execution backend it would need to represent |
| Progress mapped to real backend events | Fail | The audit trail already emits `decision_requested → fence_consumed → tool_completed` (M5 packet); nothing in `src/` consumes it |
| Adoption/error monitoring planned | Fail | None found |
| Rollout plan for the UI | Fail | None found |

**Findings:** F-U1, F-U2, F-U3, F-U4.

---

## 3. Findings

Severity vocabulary is exactly: `blocks-production` / `degrades-under-load` / `degrades-UX` / `debt`.

### F-S1 — Decision fences are single-use per process, not per platform
**What's wrong.** `services/pdp/PolicyDecisionPoint.ts:23` — `private readonly consumedFences = new Set<string>();`. This is constructed once per `createAgentPolicyReplica` call (`orchestrator-service/src/agentPdpReplica.ts:41`), which happens once per orchestrator-service process. Under N horizontally-scaled orchestrator replicas, a fence consumed on replica A is invisible to replica B — the same fence could be replayed against a different replica.
**Severity:** `blocks-production` — this is a direct instance of ADR-005-004 ("[a decision fence] is neither a reusable token nor a replay stream") not holding once the Orchestrator scales past one replica, which Doc 004 §15 requires it to do (2,000-workflow acceptance floor implies many replicas).
**Pattern.** No new external pattern is needed — Doc 001 §18 already cites Stripe's idempotency-key design (bound to a shared store, not process memory) as the model the platform follows elsewhere (`TRANSACTIONAL-OUTBOX`, `AUTHZ-LIVE-DECISION`). The fix is applying the platform's own already-accepted pattern to a spot that currently doesn't.
**Landing site.** `services/pdp/PolicyDecisionPoint.ts:23,49`; `orchestrator-service/src/agentPdpReplica.ts:41-70`.
**Proposed module — "Shared fence ledger for the agent PDP replica."**
- *Goal:* `consumeFence` checks and records fence consumption in a store shared across every orchestrator replica, not process memory.
- *Ships:* a `FenceLedger` port (`has(fenceId)`/`record(fenceId, expiresAt)`) injected into `PolicyDecisionPoint`; a durable implementation (reuse whatever the platform already uses for `admin_action`-class shared state — likely the same Postgres instance M-DR for sessions would introduce, see F-S2); an in-memory implementation for tests, kept byte-identical to today's default so single-replica dev/test behavior doesn't change.
- *Holds (named tests):* `pdp.fence.cross-replica-rejected` — two `PolicyDecisionPoint` instances sharing one `FenceLedger`, consume on one, replay on the other, expect `FENCE_INVALID`; `pdp.fence.single-instance-unchanged` — existing single-instance fence tests pass byte-identical.
- *Untouched:* `services/pdp/PolicyDecisionPoint.ts`'s public API shape (the port is an added constructor dependency, not a signature change to `decideBatch`/`consumeFence`); `services/agent-integration/**`.
- *ADR impact:* **none.** This closes a gap in reaching ADR-005-004, it does not change it.

### F-S2 — Agent run/session state is process-local and file-backed, with no Doc 022 placement
**What's wrong.** `orchestrator-service/src/agentHarness.ts:169` (`admittedRuns = new Map(...)`) and `:469` (`sessionsRoot: options.sessionRoot ?? join(process.cwd(), ".lens-agent-sessions")`) — both are local to one orchestrator process and one machine's disk. Doc 022 §5.1's state-class placement table enumerates every stateful owner in the platform with its synchronous authority and DR rule; agent-harness run/session state has no row. This is silence, not an accepted "ephemeral, no recovery guarantee" classification (compare the table's explicit `Ephemeral runtime` row, which names active streams/KV cache/sandbox temp — a genuinely ephemeral class that agent run state does not resemble, since a run in progress represents real consumed budget and partial tool-call history an employee may need to resume against).
**Severity:** `blocks-production` — violates ADR-004-001 ("no Orchestrator-local workflow record is authoritative") for a component that will carry real employee task state, and leaves a real stateful artifact with zero RPO/RTO classification anywhere in the HA/DR document.
**Pattern.** None new; `pi-agent-core`'s own `SessionRepo` interface (currently satisfied by `JsonlSessionRepo`) is designed to be pluggable — this is exactly the kind of storage-conformance-suite situation the harness vendor doc anticipates (`00-START-HERE.md` treats the harness as bringing its own session-persistence machinery "unmodified").
**Landing site.** `orchestrator-service/src/agentHarness.ts:169,469-471`; Doc 022 §5.1 (missing row).
**Proposed module — "Durable, shared agent session/run store."**
- *Goal:* replace the local `JsonlSessionRepo` default and the in-process `admittedRuns` map with a shared, replica-independent store for anything Doc 022 needs to name.
- *Ships:* a Postgres-backed `SessionRepo` implementation conforming to `pi-agent-core`'s existing session interface (SQLite-local/Postgres-production, mirroring the pattern the MCP registry already uses per the M6A packet); a durable `admittedRuns`-equivalent keyed by `agent_run_id`, reconcilable on replica restart; a new row in Doc 022 §5.1 classifying agent run/session state (recommended: alongside `Agent/tool/budget ledgers` — same RPO/RTO class, since both represent real, partially-consumed, employee-visible work).
- *Holds:* `harness.session.survives-replica-restart` — start a run, kill the process holding it, resume from a second process reading the same store, get the same session; `harness.run-state.no-duplicate-admission-across-replicas` — extends M0's existing concurrency-isolation test to two processes sharing the store.
- *Untouched:* `orchestrator-service/src/agentHarness.ts`'s external construction-site signature (`createProductionAgentHarness`) — the change is inside, not to its inputs/outputs; `services/agent-integration/**`.
- *ADR impact:* **none** on Doc 004 (this reaches ADR-004-001, doesn't change it). Requires a documentation addition to Doc 022 §5.1 — a table row, not an ADR.

### F-S3 — Agent multi-step model dispatch is not sized into Doc 013's admission floor
**What's wrong.** `DEFAULT_MAX_STEPS = 4` (`orchestrator-service/src/agentHarness.ts:50`) means one agent run can consume up to 4 model-step admissions, each independently reserved and fenced per Doc 004 §11. Doc 013 §Normative v6.1 sizes exactly two admission classes for Phase 2 — router (`rag-route-classification`) and final generation — at ≥43 starts/s each. There is no third reserved bulkhead for agent-step generation, and `07-M6-mcp-tools.md` §2's estimation table only covers MCP *tool-call* rate (8 calls/s), not the model-dispatch rate agent steps add.
**Severity:** `degrades-under-load` — at M0/M5's proven 10-concurrent-run scale this is invisible; at M6's own assumed peak of 50 concurrent runs it is not (worst case ~200 extra model-step admissions/s with no reserved capacity, competing with router and final-generation bulkheads that were sized without it).
**Pattern.** No new pattern — this is the same technique Doc 013 v6.1 already used for the router class, applied to a third class.
**Landing site.** `orchestrator-service/src/agentHarness.ts:50-51`; `07-M6-mcp-tools.md` §2; Doc 013 §Normative v6.1.
**Proposed module — "Agent-step admission bulkhead."**
- *Goal:* size and reserve a third Scheduler bulkhead for agent-step model dispatch, the way v6.1 did for the router.
- *Ships:* a Doc 013 addendum (v6.x, same shape as v6.1) with `agent_step_floor_starts_per_second` derived from measured `maxSteps × concurrent-run` load, not assumed; Scheduler config wiring for the new class.
- *Holds:* a Doc 013-style acceptance gate — "saturating agent-step admission to its floor leaves router and final-generation able to sustain their own floors, and the reverse" (mirrors the existing router/final isolation gate in Doc 013 §v6.3).
- *Untouched:* everything in `services/pdp`, `services/agent-integration`.
- *ADR impact:* none — extends the pattern behind ADR-SCHED-011, doesn't change it.

### F-S4 — M6's stated concurrency floor is not the concurrency that was proven
**What's wrong.** `07-M6-mcp-tools.md` §1 states "Concurrency | 50 concurrent runs (M0's proven envelope)" and §2's estimation table asserts "Concurrent runs (peak) | 50." `01-M0-vendor.md`'s actual acceptance criterion (§5) is `harness.concurrency.isolation` at **"at least 10"** concurrent instances, and every subsequent module's own evidence (M5 packet: "Concurrent sessions: 10"; M6b's `mcp.concurrent-isolation` hold: "Ten sessions as well") only ever exercises 10. Nothing in the repository has run or proven 50.
**Severity:** `debt` — a documentation-accuracy problem, not a runtime one, but the same principle Doc 001 §8 states for GPU sizing ("never from vendor-published benchmark numbers," i.e., claims must be evidence-based) applies here: a capacity claim that overstates its own proof by 5× should not be load-bearing for anything downstream (including F-S3's future sizing work, which should not inherit "50" as if it were measured).
**Landing site.** `07-M6-mcp-tools.md` §1, §2; `01-M0-vendor.md` §5.
**Proposed correction (doc-only, no module needed):** change "50 concurrent runs (M0's proven envelope)" to state the actual proven number (10) and, if 50 is the intended target, mark it explicitly as an unvalidated target pending a real 50-way concurrency test — not an envelope already proven.
**ADR impact:** none.

### F-P1 — Agent session transcripts have no Doc 016 governance ownership
**What's wrong.** The same `JsonlSessionRepo` local files from F-S2 hold full model reasoning and tool-call history — the shape of content Doc 016 §4's `Document`/`DerivedArtifact` model exists specifically to classify, retain, and eventually delete. There is no entry for it. This is the same structural gap the 2026-08-10 audit flagged as **C-09** ("observability can become an unauthorized second conversation store") — but C-09 was about Doc 020 telemetry versus Doc 008 Memory, both of which now have a settled contract; this is a *third*, newer store the settled contract doesn't cover, because it didn't exist in August.
**Severity:** `blocks-production` — an ungoverned copy of conversation-shaped content is exactly the failure mode the platform's core invariant (Doc 001 §1, "Lens's value is that all of the above stays true under load, under attack, and under audit") exists to prevent, and it is currently true of a real, shipping component.
**Pattern.** Apply Lens's own established pattern (Doc 008's governed-blob-writer / `TURN-FINAL-OUTPUT` contract, and the `[withheld]`-stub pattern M1/M4 already apply correctly elsewhere) to this store. No external pattern needed — this finding is precisely the shape the task brief predicted: "find where that pattern is not yet applied."
**Landing site.** `orchestrator-service/src/agentHarness.ts:469-471`; Doc 016 §4 (no entity for agent session transcripts); Doc 022 §5.1 (same missing row as F-S2).
**Proposed module — "Governed agent session transcripts."**
- *Goal:* agent session transcripts get a Doc 016 entity, a retention/classification path, and a deletion contract, the same way Memory turns do.
- *Ships:* a `DerivedArtifact`-shaped Doc 016 record type for session transcripts; a write path that goes through Doc 016 registration instead of a bare local file (this can share the durable `SessionRepo` from F-S2's module — same underlying migration, additional governance metadata written alongside).
- *Holds:* `governance.session-transcript-registered` — every session write produces a Doc 016 registration event; `governance.session-transcript-deletable` — a deletion request against a session transcript actually removes the governed artifact, verified the same way Doc 016's existing deletion tests verify document deletion.
- *Untouched:* `services/pdp/**`, `services/agent-integration/**` (the write path change is inside `agentHarness.ts`'s session construction, not the governance/context binding hooks that already fence tool calls).
- *ADR impact:* none — extends ADR-016-001/004's existing regime to a new artifact type, doesn't change the decision.

### F-P2 — MCP servers are new tool targets without the required transitive-egress data-flow profile
**What's wrong.** Doc 023 §14 (`TRANSITIVE-TOOL-EGRESS`, owner "023 Network Edge / 014 Tool Catalog") requires every Doc 014 tool target to carry a reviewed data-flow profile — external-delivery capability, recipient domain, DLP ceiling — before it's eligible for protected data. The M6A registry schema (confirmed from the M6A review packet's file list and diff: `services/mcp-registry/McpRegistry.ts` stores `id`, `endpoint`, `secret_ref`, `transport`, approved tools with `schemaDigest`/`resultAuthorization`/provenance path, and `state`) has no field for this. `07-M6-mcp-tools.md` classifies MCP servers as "untrusted content sources, same threat class as uploaded documents" (ADR-015-005) — which is the correct *inbound* trust posture — but says nothing about whether a `resource-gated` tool's call arguments (which can carry retrieved excerpts) can be relayed onward by the MCP server itself to an external destination.
**Severity:** `blocks-production` — this is 2026-08-13's **SEC-C05** ("internal tool target can be an external data relay") recurring on a target class the original remediation could not have covered, because MCP integration postdates it.
**Pattern.** Doc 023 §14's own existing contract, applied to a class it hasn't reached yet. No new external pattern needed.
**Landing site.** `services/mcp-registry/McpRegistry.ts` (registration schema); Doc 023 §14; Doc 001 contract register, `TRANSITIVE-TOOL-EGRESS` row.
**Proposed module — "MCP server data-flow review."**
- *Goal:* an MCP server cannot be approved without an admin-reviewed data-flow profile, the same way a tool cannot be approved without a schema digest.
- *Ships:* a `dataFlowProfile` field on the MCP server registration record (`externalCapable: boolean`, `recipientDomains: readonly string[]`, `dlpCeiling: DataClass`); admin-approval route validation that rejects approval of any tool on a server whose profile is missing or marked `externalCapable` for a `resource-gated` tool without an explicit compliance exception.
- *Holds:* `mcp.external-capable-resource-gated-rejected` — attempting to approve a `resource-gated` tool on a server marked `externalCapable` without an exception is refused at the admin route; `mcp.data-flow-profile-required` — registration without the profile field fails closed (extends the existing `mcp.admin-only`/`mcp.http-only` style of test in `server/tests/mcpServers.test.ts`).
- *Untouched:* `services/pdp/**`, `services/agent-integration/**`, `orchestrator-service/src/agentHarness.ts`.
- *ADR impact:* none — this is `TRANSITIVE-TOOL-EGRESS` applied, not amended.

### F-P3 — Cross-reference: F-S1's fence-replay gap is also a live-authorization integrity gap
The in-process `consumedFences` state (F-S1) is a scalability problem in that it silently degrades correctness as replicas scale, but from the privacy/security lens it is more precisely: a live, exploitable violation of ADR-005-004 the moment a second orchestrator replica exists. No separate module is proposed here — F-S1's module closes this too — but the severity read from this lens is unambiguously `blocks-production`, not merely a performance concern, and it should be scheduled with that urgency (see §4).

### F-P4 — No red-team campaign family for the MCP tool surface
**What's wrong.** Doc 018 §12 (Normative v7, 2026-08-23) added three campaign families specifically because the runtime-adapter/adaptive-RAG work introduced new attack surface: router manipulation, adapter/runtime-boundary SSRF, and attempt-durability/cancellation abuse. All three predate M6. There is no fourth family for: schema-drift bypass attempts (an MCP server racing its own schema change against the connector's cache-with-TTL check), a `resource-gated` tool lying about its declared JSON path to smuggle content past the "path absent → withheld" rule, or a compromised/malicious MCP server attempting to use its single-action credential-broker channel for anything beyond the granted scope.
**Severity:** `blocks-production` — Doc 018's own implementation-verdict language ("go additionally requires executed router-manipulation, adapter-boundary and attempt-durability campaigns...") establishes that a live production security control needs adversarial-test evidence before go-live is credible; the MCP surface has an equivalent-shaped control (M1's fence, M4's resource-ref filter, M6b's synthetic `tool:` ref) with no equivalent campaign.
**Pattern.** Extends Doc 018's own existing methodology (signed findings against an exact digest manifest, isolated namespaces, no production credentials) — no new external pattern.
**Landing site.** `07-M6-mcp-tools.md` (no red-team section); `services/mcp-registry/McpHttpConnector.ts`; Doc 018 §12.
**Proposed module — "MCP tool-surface red-team campaign."**
- *Goal:* a fourth Doc 018 §12 campaign family, "MCP tool-surface manipulation," with the same isolation constraints as the existing three.
- *Ships:* a Doc 018 addendum (§12.4-equivalent) naming the attack cases above plus a `resource-gated` provenance-forgery case; a stub-MCP-server-based test harness reusing `tests/helpers/stubMcpServer.ts` from M6A.
- *Holds:* signed findings per case, gated the same way the existing three families are (Doc 018 §12.4's gate table, extended with Doc 004→ replaced by the MCP registry as the named owner for this family's findings).
- *Untouched:* `services/pdp/**`, `services/agent-integration/**`.
- *ADR impact:* none — extends Doc 018's existing pattern.

### F-A1 — No accessibility requirement exists anywhere in the platform (spec's finding #1)
**What's wrong.** See §1.3. No WCAG target, no perceivability obligation in Doc 001 §10's binding cross-cutting requirements list, no accessibility mention in any of the 25 documents or either August audit.
**Severity:** `blocks-production` — a sovereign enterprise platform sized for 10,000+ employees will, as a matter of workforce composition, be procured against accessibility requirements (WCAG 2.2 AA / Section 508-shaped obligations are standard in enterprise procurement); shipping with zero stated target is a go-live risk in the same category as the other cross-cutting requirements Doc 001 §10 already treats as mandatory.
**Landing site.** Doc 001 §10 (the list itself); no code landing site — this is a documentation gap.
**Proposed module — "Accessibility as a cross-cutting requirement."**
- *Goal:* add perceivability/operability (WCAG 2.2 AA) to Doc 001 §10's binding list, the same way audit logging or zero-egress are binding on every subsystem with a UI.
- *Ships:* one new bullet in Doc 001 §10; a corresponding line in Doc 023 (endpoint/UI-adjacent) or a new subsystem-agnostic cross-reference, whichever the document owner prefers — this review does not prescribe which numbered document should carry the detailed contract, only that §10's list currently has none.
- *Holds:* none (documentation-only); the accessibility remediation module (F-A2–F-A5) is where testable holds belong.
- *Untouched:* everything else in Doc 001.
- *ADR impact:* **this changes binding text in Doc 001 §10.** Per the spec's constraint, stated explicitly: this is not one of the 22 numbered ADRs in §11, but §10 is binding on every subsystem document, and adding a row to it is a change to that binding list. It should go through whatever change-control Doc 001 §12 already prescribes for cross-cutting requirement changes.

### F-A2 — Tertiary/placeholder text fails contrast where it carries real content
**What's wrong.** `#A09C92` on `#F7F7F4` computes to 2.55:1 (WCAG relative-luminance formula), below even the 3:1 large-text floor. `DESIGN-lens.md` itself marks this pair "inferred, ratify." `AgentWorkflow.tsx` uses the corresponding tokens (`--text-tertiary`, `--text-disabled`) for the tool name and duration timestamp — real, non-decorative information.
**Severity:** `degrades-UX`.
**Landing site.** `DESIGN-lens.md` (tertiary/placeholder row); `src/index.css` (token definition); `src/components/ai/AgentWorkflow.tsx` (consumer rendering real content at this contrast).
**Proposed module — "Ratify or replace the tertiary text token."**
- *Goal:* either darken `#A09C92` to a value that clears 4.5:1 on `#F7F7F4` (a value around `#6E6A62` clears it, by the same formula) for any use carrying real information, or split the token into a true-decorative "placeholder" value and a separate "tertiary-but-readable" value used where `AgentWorkflow.tsx` and similar components put real content.
- *Ships:* the token change plus an audit of every current consumer of `--text-tertiary`/`--text-disabled` to classify decorative-vs-informational use.
- *Holds:* a contrast-ratio unit test asserting every token pair actually used for informational text (not pure placeholder) meets 4.5:1 — this is the seed of F-A5's automated gate.
- *Untouched:* backend, `services/**`.
- *ADR impact:* none.

### F-A3 — Focus-ring tokens exist but are not applied to the chat/agent surface
**What's wrong.** `--focus-ring-color/width/offset` are defined (`src/index.css`, `themeManager.ts`) and consumed in exactly 5 files (`EmptyState.tsx`, `EmptySessionView.tsx`, `toggle.tsx`, `textarea.tsx`, `scroll-area.tsx`). The actual chat path — `AIComposer`, `AIMessageBubble`'s copy button, `AgentWorkflow`'s accordion triggers — does not reference them.
**Severity:** `degrades-UX` (WCAG 2.4.7/2.4.11 risk for keyboard users).
**Landing site.** `src/index.css` (tokens); `src/components/ai/AIComposer.tsx`, `AIMessageBubble.tsx`, `AgentWorkflow.tsx` (non-consumers).
**Proposed module — "Focus ring coverage sweep."**
- *Goal:* every interactive element in the chat/agent surface uses the existing focus-ring tokens; no new tokens needed.
- *Ships:* class additions across the named components.
- *Holds:* a keyboard-navigation test (tab through the chat composer and one agent-workflow row, assert a visible focus indicator at each stop).
- *Untouched:* backend.
- *ADR impact:* none.

### F-A4 — Agent progress and terminal states are not announced to assistive technology
**What's wrong.** Zero `aria-live` regions anywhere in `src/components/ai/*` or `src/features/employee-chat/*`. `AgentWorkflow.tsx`'s "Thinking…" → "Agent is working…" → "Completed actions" transitions, and any future `INCOMPLETE`/`DENIED` terminal state, are communicated only by spinner animation and text content change — invisible to a screen-reader user who isn't focused on that DOM node when it changes.
**Severity:** `degrades-UX` — this is the literal scenario the task brief names ("an `INCOMPLETE` run must be perceivable, not just visually styled").
**Landing site.** `src/components/ai/AgentWorkflow.tsx`, `AgentPlanPanel.tsx`, `ChatWindow.tsx`.
**Proposed module — "Live-region progress announcements."**
- *Goal:* state transitions in the agent progress surface are announced via `aria-live="polite"` (status changes) and `aria-live="assertive"` reserved for the terminal `DENIED`/failed states, per WAI-ARIA APG guidance — keep the region's content concise, start empty on mount, and don't re-announce on every token of streamed text (only on state transitions).
- *Ships:* a small `role="status"` live region in the agent-workflow container, populated on `running → done`, `thinking → *`, and terminal-state transitions only.
- *Holds:* an accessibility-tree assertion test that the live region's text content changes exactly once per state transition, not per render.
- *Untouched:* backend.
- *ADR impact:* none.
- **Pattern (external, required by the spec's web-research mandate):** WAI-ARIA Authoring Practices Guide (w3.org/WAI/ARIA/apg) — "start with empty live regions... keep live region content concise... content updates [should not be] confusing or too frequent." Directly transfers: the fix above is exactly what the guide prescribes for background-operation progress, and the "don't over-announce" caution is exactly why the region should fire on state transitions, not per token.

### F-A5 — No automated accessibility gate
**What's wrong.** No `axe-core`/`pa11y`/`lighthouse-ci` in `package.json`; no `.github/workflows` directory exists at all in the repository — every gate in the M-doc series (`npm run validate`, `npm test`) is manual/local, and none of them touch accessibility.
**Severity:** `debt`.
**Landing site.** `package.json`; repository root (no CI directory).
**Proposed module — "Automated accessibility regression gate."**
- *Goal:* a contrast/aria/keyboard-trap check runs on every change to `src/components/ai/**` and fails the same way `npm run validate` already fails on a protected-path violation.
- *Ships:* `jest-axe` or equivalent wired into the existing `npm test` invocation, scoped initially to the chat/agent components this review touched.
- *Holds:* the F-A2/F-A3/F-A4 tests above, run under this gate.
- *Untouched:* everything else.
- *ADR impact:* none.

### F-U1 — Agent mode has no UI surface at all (spec's finding #1)
**What's wrong.** `agentMode: true` is a body field on `POST /api/rag/ask` with zero references anywhere in `src/` (grep confirms). The backend already produces the exact terminal-state contract a UI would need — `orchestrator-service/src/http.ts:42` (`status: "COMPLETED" | "INCOMPLETE" | "CANCELLED" | "DENIED" | "FAILED"`) threaded through `server/src/rag/orchestratorClient.ts:215` (`incomplete: true` flag on the BFF response) — and an audit trail already shaped like a step feed (`decision_requested → fence_consumed → tool_completed`, M5 packet). None of it is consumed. Separately, `src/features/employee-chat/turnState.ts` — a presentation-state contract for exactly this class of problem — has no `incomplete` state in its `EmployeeTurnState` enum and, per `grep`, zero importers anywhere in the codebase: it was designed and never wired to anything.
**Severity:** `blocks-production` — without this, the M0–M6 backend work cannot reach an employee at all; the feature the whole integration exists to deliver has no way to be used.
**Landing site.** `src/features/employee-chat/turnState.ts`; `src/components/ai/AgentWorkflow.tsx`, `AgentPlanPanel.tsx`, `ChatWindow.tsx`, `AIMessageBubble.tsx`; `server/src/rag/orchestratorClient.ts` (data already available); `src/shared/bff-auth/client.ts:159` (`/api/rag/ask` call site, `agentMode` param not yet passed).
**Proposed module — "Agent task surface."**
- *Goal:* an employee can toggle agent mode, watch a step feed, and see `INCOMPLETE`/`DENIED` presented distinctly from `COMPLETED` — nobody can mistake a partial answer for a complete one.
- *Ships:* extend `EmployeeTurnState`/`presentTurn` (or a parallel `AgentRunState`) with an explicit `incomplete` state whose `EmployeeTurnPresentation` sets `showOutput: true` (the partial output is real and cited, per Doc 004 §7's `CLARIFY`/degraded semantics) but with a persistent, non-dismissible banner distinguishing it from `completed` — never the same visual treatment; a step feed component built from `AgentPlanPanel`'s existing collapsible-checklist pattern, re-skinned with Lens's actual step categories (corpus search, MCP tool call) instead of the current IDE-coding-agent categories, driven by the `decision_requested/fence_consumed/tool_completed` audit stream; a UI toggle wired to the existing `agentMode` request parameter.
- *Holds:* `ui.incomplete-never-renders-as-complete` — a snapshot/interaction test asserting the `incomplete` presentation is visually and structurally distinct from `completed` (different container, not just a different label); `ui.step-feed-matches-audit-order` — step rows appear in the same order as `decision_requested → fence_consumed → tool_completed` events, no reordering or coalescing that could misrepresent what happened.
- *Untouched:* `services/pdp/**`, `services/agent-integration/**`, `orchestrator-service/src/agentHarness.ts` — this module consumes data these already produce and does not modify them.
- *ADR impact:* none.
- **Patterns (external, per the spec's wide-research mandate):**
  - *Banking pending-transaction UX* (industry UX guidance surveyed via Purrweb/Gapsy/Letsgroto banking-app design writeups, 2026): "a transaction that has been authorized but not cleared is not the same as one that has settled... show progress, explain what the system is doing, and inform the user about what comes next." Transfers directly to `INCOMPLETE`: an incomplete agent answer is authorized-but-not-settled, and the UI should say so in the same register a bank statement does, not silently render it as done.
  - *GitHub Actions / Linear-style step timelines* (GitHub Actions Marketplace `actions-timeline`; general timeline-UI-pattern literature): "clear status indicators make it easy to distinguish planned, active, and completed work." Transfers to the step feed: `decision_requested/fence_consumed/tool_completed` is already a three-phase-per-step event stream, which is exactly what a timeline component wants as input.
  - *Rollback-netcode desync signaling* (game-networking literature on detecting and surfacing state disagreement, e.g. bymuno.com's rollback-netcode explainer): the transferable idea isn't the network protocol, it's the *design stance* — distinguish "we don't yet know the true final state" from "confirmed complete," and never let the UI assert confidence the system doesn't have. This maps onto `OUTCOME_UNKNOWN` (Doc 011/012/022's own concept — an ambiguous model/tool outcome that must never be silently treated as success) reaching the UI as its own presentation state, not folded into either `completed` or `failed`.

### F-U2 — No admin UI for MCP registration, tool approval, or schema-drift re-approval
**What's wrong.** `server/src/routes/mcpServers.ts` (M6A) implements the full admin API — registration, discovery, approval, schema-drift detection — with no UI counterpart anywhere in `src/`.
**Severity:** `degrades-UX` (an admin *can* operate this via direct API calls, unlike F-U1, so it's not a hard block — but a curl-only workflow for a security-sensitive schema-diff review is not realistic production ops practice).
**Landing site.** `server/src/routes/mcpServers.ts` (API exists); no `src/features/admin/mcp/*` or equivalent exists.
**Proposed module — "MCP admin console."**
- *Goal:* an admin can register a server, see discovered tools, approve a subset, and — critically — see a diff when a tool's schema drifts, with the same re-approval friction `07-M6-mcp-tools.md` §4b intends ("Loud beats silent").
- *Ships:* a registration form; a tool-approval list with per-tool `resultAuthorization` mode selection; a drift view showing old-schema-vs-new-schema (ideally incorporating F-P2's data-flow-profile fields once that module lands).
- *Holds:* `admin.drift-shows-diff` — a UI test that a drifted tool's approval screen renders both schema versions, not just a "changed" flag.
- *Untouched:* `services/mcp-registry/**` (consumed as-is via its existing admin API).
- *ADR impact:* none.
- **Pattern (external):** GitHub's app-permission re-approval flow (docs.github.com "Reviewing and modifying installed GitHub Apps"; "dismiss stale approvals" branch-protection pattern) — "any new commit... automatically invalidate previous approvals... forces the reviewer to look at the diff again." Transfers directly: this is the exact mechanism `07-M6-mcp-tools.md` describes in prose without a UI to realize it.

### F-U3 — The existing "agent is working" visual language is wired to the wrong backend concept
**What's wrong.** `AgentWorkflow.tsx`'s category taxonomy (`thinking`, `read`, `write`, `edit`, `terminal`, `search`, `git`, `generic`) describes a filesystem/coding agent — matching neither `search_corpus` nor MCP tool calls, the only two tool types the actual Lens backend has. The component is live code (referenced from `AIMessageBubble.tsx`/`ChatWindow.tsx`), not dead — but conceptually it belongs to a different product than the one M0–M6 built.
**Severity:** `debt` — nothing breaks today because nothing calls it with real agent data yet (F-U1 is what would first exercise it), but it will need to be re-skinned, not reused as-is, when F-U1 lands.
**Landing site.** `src/components/ai/AgentWorkflow.tsx:26-38` (`CATEGORY_META`, `inferCategory`).
**Note for the redundancy-audit track.** `11-REDUNDANCY-AUDIT.md`'s "known lead" is specifically the removed IDE pane; this component is *not* dead code by that audit's own criteria (it has live callers), so it would not surface as a `dead`/`ide-leftover` finding there — but its category taxonomy is IDE-shaped residue inside otherwise-live code, which that audit's `convoluted` classification might reasonably cover. Flagging it here for that track's Phase 1 sweep rather than proposing a module in this review, per this document's own constraint against overlapping proposals with the redundancy audit.
**ADR impact:** none.

### F-U4 — Two disconnected chat-like surfaces coexist with no stated relationship
**What's wrong.** `src/components/ai/AIPanel.tsx` (and its siblings `AIComposer`, `DiffViewer`, `ReviewChangesPanel`) import from `mock-data.ts` (`MOCK_DIFF`, `MENTION_ITEMS`, `INITIAL_PROJECTS`) — a demo/prototype surface. `src/features/employee-chat/turnState.ts` is a real presentation contract for the actual RAG backend, unconsumed by anything. It is not obvious from the code which of these is meant to become the production employee chat surface, or whether both are meant to converge.
**Severity:** `debt` — this is exactly the kind of ambiguity that will compound when F-U1's module has to pick a landing site.
**Landing site.** `src/components/ai/AIPanel.tsx`, `mock-data.ts`; `src/features/employee-chat/turnState.ts`.
**Proposed correction (product decision, not a code module):** before F-U1 is scheduled, the product owner should state explicitly whether `AIPanel` is the intended chassis for the real employee chat surface (in which case its mock data gets replaced, not its structure) or whether `employee-chat`'s presentation contract is meant to drive an as-yet-unbuilt surface (in which case `AIPanel` should be marked prototype-only). This review does not have the standing to make that call; it only has the standing to point out that nothing in the repo currently states it.
**ADR impact:** none.

---

## 4. Ranked backlog

Ordered by severity, then effort (smaller effort first within the same severity), with dependencies noted.

| # | Module | Findings closed | Severity | Effort | Depends on |
|---|---|---|---|---|---|
| 1 | Shared fence ledger for the agent PDP replica | F-S1, F-P3 | blocks-production | Small–medium | — |
| 2 | MCP server data-flow review | F-P2 | blocks-production | Small–medium | — |
| 3 | Accessibility as a cross-cutting requirement (doc change) | F-A1 | blocks-production | Trivial | — |
| 4 | Durable, shared agent session/run store | F-S2 | blocks-production | Medium | can share infra with #1 |
| 5 | Governed agent session transcripts | F-P1 | blocks-production | Medium | benefits from #4's store migration |
| 6 | MCP tool-surface red-team campaign | F-P4 | blocks-production | Medium | benefits from #2's data-flow fields as a test input |
| 7 | Agent task surface | F-U1 | blocks-production | Large | #1, #4 (needs replica-safe, durable run state before showing consistent progress across reconnects) |
| 8 | Agent-step admission bulkhead | F-S3 | degrades-under-load | Small | — |
| 9 | Live-region progress announcements | F-A4 | degrades-UX | Small | ideally lands inside #7, not after it |
| 10 | Ratify or replace the tertiary text token | F-A2 | degrades-UX | Small | — |
| 11 | Focus ring coverage sweep | F-A3 | degrades-UX | Small | — |
| 12 | MCP admin console | F-U2 | degrades-UX | Medium | benefits from #2's fields |
| 13 | Automated accessibility regression gate | F-A5 | debt | Small | seeded by #9/#10/#11's tests |
| 14 | M6 concurrency-claim correction (doc-only) | F-S4 | debt | Trivial | — |
| 15 | Product decision + handoff to redundancy-audit track | F-U3, F-U4 | debt | Trivial (decision) / handoff | — |

**Sequencing note beyond the table:** #3, #10, #11, #9 are cheap enough, and #7 (the large module) benefits enough from having them already solved, that doing the accessibility work *before* building the agent task surface is strictly better than retrofitting it — this is called out explicitly so nobody schedules #7 first and treats accessibility as a follow-up pass.

---

## 5. What we deliberately did not propose

- **No cache or queue for MCP tool calls.** `07-M6-mcp-tools.md` §7 already argues this correctly at 8 calls/s ("the bottleneck is the MCP server, not us... add when a profiler says so"). This review agrees and does not revisit it; F-S3's proposed bulkhead is about the *model-dispatch* side of agent steps, not the MCP call path, and does not imply a queue there either — a queue would still break the M1 tool-boundary fence's deadline binding, exactly as the existing doc says.
- **No protected generated-response or semantic caching for agent output.** ADR-CACHE-004 already disables this platform-wide and nothing about the agent path changes the argument (if anything, an agent's intermediate tool results are *more* dependency-laden than a one-shot answer, which strengthens the existing "no" rather than weakening it).
- **No stdio MCP transport or dynamic tool discovery.** `07-M6-mcp-tools.md` already scopes these to Phase 2 behind the `microvm` isolation class, correctly — arbitrary process spawning is code execution, and Doc 015's isolation model (referenced but not itself re-examined in this pass) is the right place for that decision, not an HTTP-only tool registry.
- **No re-evaluation of prefill/decode disaggregation.** ADR-SCHED-010 already defers this pending benchmarks; agent-step load (F-S3) makes the router/final/agent-step accounting more complex but doesn't change the disaggregation cost-benefit calculus enough to reopen that ADR.
- **No proposal touching `services/pdp`, `services/agent-integration`, or the audit ledger that removes or weakens a control.** Every proposed module in §3 is additive (a shared store behind an existing interface, a new schema field, a new documentation row, a new UI surface reading data that already exists). Confirmed by re-reading §3 against this constraint before finalizing.
- **No full WCAG 2.2 AA audit of every screen.** Out of this review's scope and time budget — see §6.

---

## 6. What I couldn't complete, and why

- **Full WCAG audit.** This review sampled the chat/agent transcript and the palette contract only (per the task's explicit accessibility scope: "keyboard reachability of every control, focus visibility... contrast of the DESIGN-lens.md palette pairs... screen-reader semantics of the chat transcript and citation UI, reduced-motion respect, and the agent-run progress state"). Settings screens, the source-control panel, the command palette, and the terminal component were not individually audited; F-A5's proposed automated gate is partly a mitigation for not having done this by hand everywhere.
- **`agent-run-authority-service/` and `authority-service/` were not read in depth.** The codebase graph surfaced them as entry points; M5's review packet references an "agent run authority" concept consistent with Doc 014's `AGENT-EXECUTION-ENVELOPE`, but this review's scalability findings (F-S1/F-S2) are grounded in `orchestrator-service/src/agentHarness.ts` and `services/pdp/` directly rather than tracing whether `agent-run-authority-service` already solves part of F-S2. If it does, F-S2's proposed module should be scoped down accordingly — this is worth a quick check before scheduling #4 in the backlog.
- **`08-INTEGRATION-TEST-GUIDE.md` was not read.** It's a test-execution guide, not a design decision document, and the spec's reading list for this review names module docs and review packets specifically; skipped to keep the pass within budget.
- **Contrast ratios were computed by hand** against the WCAG relative-luminance formula, not via an automated tool — the two spec-named pairs and the one additional pair this review flagged (tertiary/placeholder) should be re-verified with `axe`/a contrast-checker as part of F-A5's gate, though the arithmetic here is straightforward enough (single sRGB triplets, no gradients or transparency) that a meaningful error is unlikely.
