# Design Review — Scalability, Privacy, Accessibility, UX

**Review task. Produces a findings document. Writes no code.** Requires M7
merged. The document will be audited against the system-design corpus and the
codebase by someone who did not write it; proposals that don't reconcile with
what's already decided, or that don't name where they land, will be sent back.

Prerequisite: read `lens-agent-integration/00-START-HERE.md`.

---

## Token discipline

Load `ponytail`. Use the codebase graph (`codebase-memory-mcp cli
get_architecture`, `search_graph`, trace tools) to orient before reading
files. The 25 design documents are large; read the ones each lens needs, not
all of them.

## What Lens is, in one paragraph

A sovereign enterprise AI platform. A company controls one model and its key;
employees worldwide use it through Lens; a RAG layer over company documents is
scoped per employee by a Policy Decision Point, server-side, before the model
sees anything. As of M0–M6 it also runs a governed multi-step agent (the Prime
Agent harness) whose every tool call is PDP-authorised and whose every
retrieved document is re-checked before reaching the model, with MCP servers
pluggable as governed tool backends. The value proposition is that all of
this stays true under load, under attack, and under audit.

## The baseline you reconcile against

The 25 numbered system-design documents at `/Volumes/hir0-ssd/Lens/`
(`001-…` through `025-…`) are the architectural baseline. **They predate the
agent and MCP work.** Also there: `architecture-audit-2026-08-10.md`,
`security-architecture-audit-2026-08-13.md`, and several
`*-reconciliation-*.md` reports — read these so you do not re-raise something
already found and settled.

Start with `001-overall-system-architecture.md` in full. §23 holds the
canonical readiness verdict; every proposal must be consistent with it or
explicitly argue for changing it.

For what was actually built since: `lens-agent-integration/` in the repo —
the module docs and every `M*-REVIEW-PACKET.md`.

## Method — the system-design framework

Apply this to each lens. Score the current state honestly before proposing.

**Four-step:** (1) requirements and scope, (2) high-level design, (3) deep
dive on the 2–3 hardest components, (4) tradeoffs and future improvements.
Never propose before stating requirements.

**Estimation:** QPS = DAU × actions ÷ 86,400; peak 2–5× average. Storage =
records × size × retention. State numbers; order of magnitude is enough.
Introduce a building block (cache, queue, replica, shard, CDN) **only where
its specific bottleneck appears** — the estimate has to show the bottleneck.

**Quick Diagnostic** — score each lens `round(passed / 8 × 10)`:

| Row | Pass if |
|---|---|
| Requirements listed | functional and non-functional, with SLAs |
| QPS and storage estimated | numbers, not adjectives |
| Every component redundant | replicas / failover / multi-AZ named per component |
| DB scaling strategy stated | vertical → replicas → sharding, with shard key |
| Cache for read-heavy paths | with TTL and invalidation on write |
| Async via queues | for non-latency-critical paths |
| Monitoring and alerting | metrics, logs, traces, thresholds |
| Deployment strategy | rolling / blue-green / canary with rollback |

A "no" that's deliberate and argued is fine and must be written down so nobody
adds the block reflexively later. A "no" that's an omission is a finding.

## The four lenses

### Scalability
Docs: 004 orchestrator, 009 cache hierarchy, 012 inference pool, 013 GPU
scheduler, 022 HA/DR, 023 multi-building. Then the agent path specifically:
M0 proved 10 concurrent harness instances; M5 wired one construction site in
`orchestrator-service`. What happens at 50 concurrent runs? 500? Where does
the PDP replica's in-process state (`consumedFences`) break under multiple
orchestrator replicas? Sessions are file-backed today — at what point does the
harness's storage conformance suite need a Postgres implementation?

### Privacy
Docs: 005 PDP, 016 document governance, 021 audit, 025 secrets, 002 identity
sync, 018 red team. The agent adds new data flows: tool results, MCP server
responses, session transcripts, `/refine`-style self-modification (not yet
enabled). Trace each new flow end to end: what's retained, where, for how
long, who can read it, how it's deleted. The `[withheld]` stub and the
`context_filtered` counts-only log are the pattern — find where that pattern
is **not** yet applied.

### Accessibility
**None of the 25 docs cover it.** That is itself finding #1. Audit the
frontend (`src/`) against WCAG 2.2 AA: keyboard reachability of every
control, focus visibility (the theme has `--focus-ring-*` tokens — are they
used everywhere?), contrast of the `DESIGN-lens.md` palette pairs (compute the
ratios; `#5A5852` on `#F7F7F4` and `#9B9B9B` on `#141414` in particular),
screen-reader semantics of the chat transcript and citation UI, reduced-motion
respect, and the agent-run progress state — an `INCOMPLETE` run must be
perceivable, not just visually styled.

### UX
The product gaps the integration surfaced, in priority order:
1. **Agent mode is API-only.** There's no toggle, no progress display, no way
   for an employee to know a run is agentic or to see its steps. Design the
   surface: how a task is assigned, how progress is shown (the audit events
   `decision_requested → fence_consumed → tool_completed` are a natural
   step feed), how `INCOMPLETE` and `DENIED` are presented so nobody acts on
   a partial answer as if complete.
2. **Admin surfaces** for MCP registration, tool approval, and schema-drift
   re-approval — the diff view an admin needs to re-approve a drifted tool.
3. The existing chat/RAG UX, reviewed with fresh eyes.

## Web research — required, and deliberately wide

You have a free hand to search for patterns from **any** product or domain:
Dropbox, Discord, Figma, Linear, games (server-authoritative netcode, replay
systems, anti-cheat), social platforms, banking apps, medical software,
air-traffic systems. **Do not restrict yourself to products solving the same
problem.** The transferable pattern for showing an employee that an agent run
was cut short might come from how a game shows a desync, or how a bank shows a
pending transaction. Search for similar problems and different problems; you
can't know in advance what fits.

For each pattern you bring back, state: the source, the problem it solves
there, why it transfers here, and **exactly where it lands in Lens** — file,
service, or doc section. A pattern without a landing site is not a finding.

## What to produce

`lens-agent-integration/DESIGN-REVIEW-<date>.md`, structured:

1. **Baseline reconciliation** — per lens, what the 25 docs already decide,
   with doc and section references. Anything the August audits already
   settled, listed so it's visibly not re-raised.
2. **Per lens:** requirements as you read them; estimation with numbers;
   Quick Diagnostic score with each row's evidence; findings.
3. **Findings** — each one:
   - What's wrong or missing, with the file / service / doc where it's
     observable
   - Severity: `blocks-production` / `degrades-under-load` / `degrades-UX` /
     `debt`
   - Pattern proposed, with source and why it transfers
   - **Landing site** in the codebase
   - **Proposed module** in the M-doc shape: goal, ships, holds (invariants
     with named tests), untouched paths. Not implementation — the shape of
     the work so it can be scheduled and audited
   - Whether it changes anything decided in the 25 docs; if so, which ADR
     and the argument
4. **Ranked backlog** — every proposed module, ordered by severity then
   effort, with dependencies between them.
5. **What you deliberately did not propose** and why — the "no" rows from
   the diagnostic, argued.

## Constraints

- **No code changes.** This is a review.
- Every finding names a landing site. Every proposal reconciles against the
  docs. Every pattern names its source.
- Do not propose removing or weakening any control in `services/pdp`,
  `services/agent-integration`, or the audit ledger. Privacy proposals add
  controls or extend the existing pattern; they don't loosen it.
- If a finding would change an ADR, say so explicitly rather than proposing
  around it.
- Cite the docs by number and section. Cite code by path and line.

## Review packet

The document itself, plus a one-page summary: score per lens, top five
findings by severity, and the first three modules you'd schedule.
