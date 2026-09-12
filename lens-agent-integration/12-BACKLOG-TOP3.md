# Backlog — first three modules from the design review

Read `00-START-HERE.md`, then `DESIGN-REVIEW-2026-09-12.md` §3 for findings
F-S1, F-P2, F-A1 and §4 for the backlog. Load `ponytail`. Use the codebase
graph before reading files. One branch per module, `codex/b<N>-<slug>`.
Gate for each: typecheck 0, no new test failures vs parent, protected-path
diff empty, review packet with every named test's real exit code.

Protected everywhere: `services/pdp/**` (B1 is the exception, stated),
`services/agent-integration/**`, `contracts/**`, `services/secrets/**`.

---

## B1 — Shared fence ledger (F-S1, F-P3) · blocks-production

**Problem.** `PolicyDecisionPoint.consumedFences` is an in-process `Set`
(`services/pdp/PolicyDecisionPoint.ts:23`). A fence issued on one
orchestrator replica can be consumed again on another. Breaks ADR-005-004.

**Build.** A `FenceLedger` port — `consume(fenceId): boolean` (atomic,
first caller wins) — injected into `PolicyDecisionPoint` beside its other
ports. Default implementation: the existing in-process `Set`, so every
current test passes unchanged. Second implementation: SQLite with a
unique-key insert (durable, matches the repo's storage pattern). Wire the
orchestrator's replica (`agentPdpReplica.ts`) to the SQLite one when
`LENS_AGENT_FENCE_LEDGER_PATH` is set; refuse `:memory:` under the
production profile.

**Also:** `M6C-REVIEW-PACKET.md` notes the orchestrator now holds an MCP
secret store (`LENS_MCP_SECRET_STORE_KEY`), which `assertAgentEnvironment`
doesn't catch. Add `endsWith("SECRET_STORE_KEY")` to that check in
`modelTransport.ts` (protected — this is the stop-and-ask; the change is one
predicate) and move the MCP credential resolution behind the same ledger
service so the orchestrator holds refs only. If that's more than ~150
lines, stop and report the shape instead.

**Holds:** `fence.replay-across-replicas-rejected` (two PDP instances, one
ledger, second consume returns false); `fence.default-ledger-unchanged`
(existing PDP suite byte-identical); `fence.memory-refused-in-production`;
`transport.no-secrets-in-env` extended to catch `*SECRET_STORE_KEY`.

## B2 — MCP server data-flow review (F-P2) · blocks-production

**Problem.** MCP servers are tool targets with no `TRANSITIVE-TOOL-EGRESS`
profile (Doc 023 §14; SEC-C05 recurring).

**Build.** Add `dataFlowProfile` to `McpToolRecord` and the admin approval
route: `{ egressClass: "none" | "internal" | "external-approved",
targets: string[] }`. Registration without it is refused. The connector
refuses to dispatch a tool whose profile is `external-approved` unless the
server is on the deployment's approved-egress list (read from
`platform/build/dependency-mirrors.json`'s allowed-destinations, or a new
sibling file — mirror that pattern). Surface the profile in the catalog
entry's `dataFlowProfileDigest`, which currently hashes a placeholder.

**Holds:** `mcp.registration-requires-data-flow`;
`mcp.external-egress-refused-unless-approved`;
`mcp.data-flow-digest-is-real` (digest changes when the profile changes).

## B3 — Accessibility as a binding requirement (F-A1) · trivial

**Problem.** Doc 001 §10's cross-cutting list has no perceivability row.
Nothing in the platform is required to be accessible.

**Build.** Doc change only — this repo doesn't hold the 25 docs, so produce
`lens-agent-integration/ACCESSIBILITY-REQUIREMENT.md` with the exact text to
add to Doc 001 §10: WCAG 2.2 AA as a binding non-functional requirement,
the four sub-rows (keyboard, focus, contrast, assistive-tech announcement
of state changes), and the gate — an automated contrast test over
`DESIGN-lens.md` pairs that carry real text, seeded from F-A2's
`#A09C92`-on-`#F7F7F4` = 2.55:1 failure. Include that test as
`tests/unit/paletteContrast.test.ts`, failing on the current value, with
the darker replacement F-A2 suggests as the fix in the same branch.

**Holds:** `a11y.palette-contrast-aa` passes after the token change;
`tokens.test.ts` updated for the new hex; `DESIGN-lens.md` updated.

---

Order: B3 (an hour), B2, B1. B1 last because its stop-and-ask is the only
one that touches a protected binding.
