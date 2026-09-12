# Cursor — Redundancy and Optimisation, Multi-Agent

Spawn **four agents, one per area below. No agent spawns sub-agents.** Each
works in `ponytail` mode (load the skill; if unavailable, the rule is: shortest
working diff, deletion over addition, reuse over reinvention, no speculative
abstractions). Each reads `lens-agent-integration/00-START-HERE.md` and
`11-REDUNDANCY-AUDIT.md` first — the audit doc is the method: four-way
verification per candidate, classify, then delete. Both phases, one branch per
agent: `cursor/redundancy-<area>`.

**Codebase graph** (use before reading files):
`~/.local/bin/codebase-memory-mcp cli search_graph --project=Users-rameelmalik-Documents-Lens-lens --query=…`
It has weak coverage of `.tsx`; for `src/` use grep.

## Per-agent mandate

1. **Study the design patterns your area should follow** — web search is
   allowed. For each pattern you apply, one line in your packet: source, why it
   fits, where it landed. Patterns without a landing site aren't applied.
2. Sweep your area for `dead`, `ide-leftover`, `duplicate`, `convoluted` per
   the audit doc. Verify four ways before touching anything.
3. Delete and simplify. **Behaviour does not change.** If a simplification
   changes any observable behaviour, it's not a simplification — leave it and
   note it.
4. Gate before and after: `npm run typecheck; echo $?` → 0; `npm test`
   recorded before, **no new failures** after (10 known-red are baseline:
   `tests/e2e/ragChat.test.ts` ×8, `tests/unit/bffRagUiApp.test.tsx` ×2);
   `npm run build` → 0; for `src/` changes, `cargo check` in `src-tauri/` → 0.
   Never pipe into `tail`/`head` when reading exit codes.

## Areas

| Agent | Scope | Start here |
|---|---|---|
| **A · frontend** | `src/`, `src-tauri/` | The removed IDE pane. Live references: `openIdeWindow` (App.tsx ×5, WorkspaceLauncher.tsx ×2, openAppWindow.ts ×1), `IdeWindowApp` (App.tsx ×3, `components/windows/IdeWindowApp.tsx`), `onIdeWindow` (TitleBar.tsx, App.tsx). Trace outward: Tauri window defs in `tauri.conf.json`, IPC commands in `src-tauri/src/`, stores, CSS, tests. A prior attempt at `git show e9f1388 -- src/App.tsx src/components/TitleBar.tsx src/components/windows/IdeWindowApp.tsx` is a candidate, unverified. Also: `TitleBarProps` carries six dead fields (verified in `REDUNDANCY-AUDIT-2026-09-12.md` §1). |
| **B · governed services** | `services/` except protected | Duplication across `services/*` vs `libs/`; convoluted long functions; the three `ToolCatalogEntry`-shaped types (`agent-runtime`, `tool-execution`, `mcp-registry`) — classify, don't unify without a stop-and-ask. |
| **C · service packages** | `server/`, `orchestrator-service/`, `authority-service/`, `runtime-adapter-sidecar/`, `retrieval-service/` | Each has its own `package.json`; find deps declared but unused, scripts nobody runs, config keys read nowhere. `orchestrator-service/src/main.ts` env-loading is the likely convolution hotspot. |
| **D · tooling** | `scripts/`, `libs/`, `platform/`, root configs, `package.json` | Root deps unused anywhere; `scripts/dev/*` that reference removed services; duplicated env-parsing helpers; `vitest`/`tsconfig` files that overlap. |

## Protected — stop-and-ask, never silent

```
services/pdp/**   services/retrieval/**   services/agent-runtime/**   contracts/**
services/agent-integration/**   services/secrets/**   services/mcp-registry/**
orchestrator-service/src/{agentHarness,agentPdpReplica,agentDevFacts}.ts
```

A finding touching these goes in the packet as a proposal with the reason;
the agent does not make the change.

## System design does not change

No service boundary moves, no authority relocates, no control weakens. If a
cleanup seems to need it, it's a design-review item — file it in the packet
under "escalate," don't do it.

## Packet per agent: `lens-agent-integration/CURSOR-<area>-PACKET.md`

Counts per class; lines removed; diffstat; protected-path diffstat (empty);
before/after failing-test sets; per finding — path, class, the four
verifications, blast radius; patterns applied with source and landing site;
`keep` list with reasons; escalations.

Merge order after audit: D → C → B → A. A last because it's the only one
that can change what a user sees.
