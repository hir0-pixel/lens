# Redundancy Audit — Dead Code, Leftovers, and Simplification

**Two phases. Phase 1 is a findings document and writes no code. Phase 2 is
implementation, one scoped module at a time, and starts only after Phase 1
is reviewed.** Requires the design review (`10-DESIGN-REVIEW.md`) complete,
so the two don't propose conflicting changes to the same files.

Prerequisite: read `lens-agent-integration/00-START-HERE.md`.

---

## Goal

The codebase should be **minimal, modular, accessible, fast** — without
changing the system design. Remove what's dead, merge what's duplicated,
simplify what's convoluted. Every removal has to *prove* it was dead; on a
sovereign platform, "looks unused" is not evidence.

## The known lead — start here

There used to be an **IDE pane** that toggled against the agent window. The
IDE was removed; its residue almost certainly wasn't. Look for:

- conditionals that always take one branch because the other pane can no
  longer mount
- layout, resize, and dock state for a pane that no longer exists
- toggles, flags, and settings whose "IDE" value is unreachable from the UI
- routes, IPC handlers, Tauri commands, and stores that only the IDE called
- CSS for IDE-only selectors; tokens only the IDE consumed
- tests that exercise the removed pane's behaviour (they pass because they
  test a stub, not because the feature works)

Trace it from the layout root outward. `src/components/workspace/`,
`src/features/shell/`, and the theme manager are the likely sites, but
confirm with the graph rather than assuming.

## Token discipline and tools

Load `ponytail`, then `ponytail-debt` and `ponytail-audit` — they are built
for exactly this. Use the codebase graph for the sweep:

```bash
codebase-memory-mcp cli get_architecture --project=<id>
codebase-memory-mcp cli detect_dead_code --project=<id>       # or the equivalent tool; run --help
codebase-memory-mcp cli trace_callers --project=<id> --symbol=<name>
```

Graph output is a **candidate list**, not a verdict. Every candidate gets
verified (below) before it appears as a finding.

## Phase 1 — findings

### Sweep

1. Graph dead-code detection over the whole tree — root `src/`, `services/`,
   `server/`, `orchestrator-service/`, `runtime-adapter-sidecar/`,
   `authority-service/`, `libs/`, `scripts/`.
2. The IDE lead, traced by hand from the layout root.
3. Duplication: near-identical functions across packages (the graph's
   similarity or the `ponytail-debt` pass), especially where a package
   re-implements something `libs/` or `services/` already exports.
4. Convolution: functions over ~80 lines with more than three levels of
   nesting, boolean parameters that select behaviour, config for values that
   never change.
5. Performance: anything O(n²) over document or message lists; repeated
   synchronous file reads in request paths; missing early returns on the hot
   path. Only what you can point at — no speculative optimisation.
6. Accessibility of the code itself: names that don't say what they mean,
   comments that describe *what* instead of *why*, modules whose public
   surface is larger than their use.

### Verify each candidate — all four, or it isn't a finding

- **Static:** the graph shows zero callers *and* a `grep` across the whole
  tree (including `.mjs`, `.json` configs, and string references such as
  route paths or IPC channel names) shows zero references.
- **Dynamic:** if the symbol could be reached by string — a route, an event
  name, a Tauri command, a config key, a plugin hook — show the registration
  site is also dead, or show the name appears nowhere.
- **Tests:** the tests that reference it, if any, test only the dead thing.
- **Blast radius:** what else becomes dead once this is removed (chase it),
  and what could break (name the test that would catch it).

### Classify

| Class | Meaning |
|---|---|
| `dead` | unreachable; safe to delete |
| `ide-leftover` | dead because the IDE pane was removed; delete, and note the design decision it reflects |
| `duplicate` | reimplements something that exists; replace with the existing one |
| `convoluted` | reachable and needed, but simpler is possible without behaviour change |
| `keep` | looked dead, isn't — say why, so nobody re-audits it |

### Produce

`lens-agent-integration/REDUNDANCY-AUDIT-<date>.md`:

1. **Summary** — counts per class; total lines removable; the IDE-leftover
   story in one paragraph.
2. **Findings** — each with: path and lines; class; the four verifications
   with evidence; blast radius; the removal or simplification as a **proposed
   module** — goal, what it deletes or changes, the "nothing breaks" gate
   (named tests), untouched paths.
3. **`keep` list** — with reasons.
4. **Grouping into modules** — findings that share a blast radius or a file
   go together; anything touching `services/pdp`, `services/agent-integration`,
   `orchestrator-service/src/agentHarness.ts`, or the audit ledger is its own
   module with a stop-and-ask on it.
5. **Order** — lowest blast radius first. The IDE leftovers first among
   equals, since they have the clearest story.

## Phase 2 — implementation, after Phase 1 is reviewed

One module per branch, `codex/redundancy-<n>-<slug>`. Per module:

- **Gate before:** `npm run typecheck; echo "exit: $?"` → 0, and `npm test`
  recorded — the failing set is your baseline. Never pipe into a pager.
- Make the change. Deletion over rewriting. If a simplification changes any
  observable behaviour, it isn't a simplification — stop.
- **Gate after:** typecheck 0; `npm test` shows **no new failures against
  your baseline**; the module's named tests pass; `npm run build` exits 0;
  and for anything under `src/`, `cargo check` in `src-tauri/` exits 0.
- Review packet per module: diffstat; protected-path diffstat (empty); the
  before/after failing-test sets; for a deletion, the four verifications
  restated for what was actually deleted.

## Constraints

- **The system design does not change.** No service boundary moves, no
  authority is relocated, no control is weakened. If a finding seems to need
  that, it's a design-review item, not a redundancy item — file it there.
- **Protected paths** (stop-and-ask, never silent): `services/pdp/**`,
  `services/retrieval/**`, `services/agent-runtime/**`, `contracts/**`,
  `services/agent-integration/**`, `orchestrator-service/src/agentHarness.ts`,
  `orchestrator-service/src/agentPdpReplica.ts`, `services/secrets/**`.
- Do not delete a test to make a gate pass. If a test only tests dead code,
  the test is part of the same finding and is deleted *with* it, with that
  stated.
- The ten known-red tests (`tests/e2e/ragChat.test.ts` ×8,
  `tests/unit/bffRagUiApp.test.tsx` ×2) are baseline, not yours. If one of
  them turns out to test dead code, that's a finding — not a reason to touch
  it in passing.
- `~$README.md` in the repo root is a Word lock file that got committed.
  It's a finding; delete it and add `~$*` to `.gitignore` as the first,
  smallest module.

## Review packet

Phase 1: the findings document plus a one-page summary — counts per class,
lines removable, the first three modules you'd schedule. Phase 2: per-module
packets as above.
