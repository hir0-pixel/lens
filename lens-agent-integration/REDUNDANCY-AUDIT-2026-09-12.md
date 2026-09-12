# Redundancy Audit — Phase 1 Findings

**Date:** 2026-09-12
**Scope:** `src/`, `services/`, `server/`, `orchestrator-service/`, `runtime-adapter-sidecar/`, `authority-service/`, `agent-run-authority-service/`, `libs/` (if present), `scripts/`, repo-root config.
**Phase:** 1 — findings only. No code changes were made to produce this document. Every candidate below was checked against the spec's four-way verification (static, dynamic, tests, blast radius) before being called a finding; anything short of all four lives in the "Not yet verified" appendix, not in the findings list.
**Constraints honored:** no proposal moves a service boundary, relocates authority, or weakens a control. Protected paths (`services/pdp/**`, `services/retrieval/**`, `services/agent-runtime/**`, `contracts/**`, `services/agent-integration/**`, `orchestrator-service/src/agentHarness.ts`, `orchestrator-service/src/agentPdpReplica.ts`, `services/secrets/**`) were read for context only; any candidate touching them is called out as its own stop-and-ask module, never folded into an ordinary finding.

---

## 0. Summary

*(This section is filled in last, after every module below is final, so the counts are accurate. See the bottom of this document for the moment; a placeholder pass runs first while the parallel sweeps are still in flight.)*

---

## 1. The IDE story

**The premise needs a correction before the finding makes sense.** The redundancy-audit brief's "known lead" describes an IDE pane that "was removed." It was not. `IdeWindowApp` (`src/components/windows/IdeWindowApp.tsx`) is live, fully functional code, reachable today from at least three real UI paths: the "Lens IDE" item in `WorkspaceLauncher`'s workspace-open menu (`src/features/shell/WorkspaceLauncher.tsx:172-180`), the `lens:open-file`/`lens:open-ide` custom-event handlers in `AgentsApp` (`src/App.tsx:248-273`), and an auto-open when a session's tool calls touch files (`src/App.tsx:488-489`). What changed is the *architecture* it runs under: Lens used to be one window with an in-window IDE pane toggled from a shared `TitleBar` (hence props like `onIdeWindow`, `sidePaneOpen`, `projectName`, `onOpenSettings` on `TitleBarProps`); it is now Cursor-style **separate OS windows** — `openIdeWindow()`/`openAgentsWindow()` in `src/features/windows/openAppWindow.ts` open or focus a second `WebviewWindow`, and `TitleBar.tsx`'s own doc-comment says so ("IDE button opens a separate OS window"). The leftover is the first architecture's prop-drilling, still declared and still passed, silently ignored by the component that replaced it. Someone had already started removing it — local branch `codex/m7-dev-agent-facts` at commit `e9f1388` strips exactly these props from `App.tsx`, `TitleBar.tsx`, and `IdeWindowApp.tsx` — but the commit's own message calls it a "wip... snapshot... to be split," it was never merged to `main`, and it was never tested in isolation. Verified independently below.

### Finding IDE-1 — `TitleBarProps` carries six dead fields from the pre-multi-window design

**Path/lines:**
- `src/components/TitleBar.tsx:16-30` (interface — dead fields: `projectName`, `onOpenSettings`, `onIdeWindow`, `sidePaneOpen`, `onAgentsWindow`, `onOpenTerminal`)
- `src/components/TitleBar.tsx:39-48` (destructuring — `onAgentsWindow: _onAgentsWindow` and `onOpenTerminal: _onOpenTerminal` are pulled out and never read in the function body; `projectName`, `onOpenSettings`, `onIdeWindow`, `sidePaneOpen` aren't even destructured)
- `src/App.tsx:636-650` (caller — passes `projectName`, `onOpenSettings`, `onIdeWindow`, `onOpenTerminal`, `sidePaneOpen` into `<TitleBar variant="agents" .../>`)
- `src/components/windows/IdeWindowApp.tsx:56-64` (caller — passes `projectName`, `onOpenSettings`, `onAgentsWindow`, `onOpenTerminal` into `<TitleBar variant="ide" />`)

**Class:** `ide-leftover`

**Static verification.** Read `TitleBar`'s full function body (`src/components/TitleBar.tsx:39-93`): it destructures only `variant`, `onAgentsWindow: _onAgentsWindow`, `onOpenTerminal: _onOpenTerminal`, `onToggleSidePane: _onToggleSidePane`, `canGoBack`, `canGoForward`, `onGoBack`, `onGoForward`. Of those, `_onAgentsWindow` and `_onOpenTerminal` never appear again anywhere in the 93-line function — confirmed by re-reading the full body, not just grepping the name (an underscore-prefixed alias reads as "intentionally unused" but is nonetheless dead). `projectName`, `onOpenSettings`, `onIdeWindow`, `sidePaneOpen` are declared in `TitleBarProps` but never destructured at all, so they cannot possibly affect render output — TypeScript accepts them structurally and they're silently dropped. `grep -rn "TitleBar\b" --include="*.tsx" --include="*.ts" src tests` (excluding node_modules) shows exactly two runtime consumers (`src/App.tsx`, `src/components/windows/IdeWindowApp.tsx`) plus one test that mocks the component away entirely (`tests/unit/bffRagUiApp.test.tsx:124-125`, `vi.mock(...) => ({ default: () => <div>TitleBar</div> })`). No other file references `TitleBar`.

**Dynamic verification.** These are plain React props, not reachable by string/route/event name, so there's no separate registration site to check. The one thing worth confirming dynamically: does anything *else* in the app supply the behavior these dead props were meant to wire up? Yes — confirmed by tracing each:
- `onOpenSettings`/`onOpenSettings` (agents side): Settings already opens via `useShellEvents({ onOpenProjects, onOpenSettings: openSettings })` (`src/App.tsx`, wired to a global `lens:open-settings`-style event/menu command), independent of `TitleBar`.
- `onOpenSettings` (ide side): `IdeWindowApp.tsx:46-52` already listens for the `window.addEventListener("lens:open-settings", ...)` event directly — the exact same settings dialog opens whether or not the dead prop exists.
- `onIdeWindow`: `openIdeWindow()` is called directly from `WorkspaceLauncher.tsx:174` and from three event handlers in `App.tsx` (lines 252, 271, 489) — none of them go through `TitleBar`. The `TitleBar`-routed call (`App.tsx:640`) was always a fourth, silently-swallowed path.
- `onAgentsWindow` (ide side): **no other path exists.** `LayoutToolbar`'s non-agents branch renders a working "Agents Window" button that calls `onAgentsWindow ?? openAgentsWindow()` (`TitleBar.tsx:382-396`), but `LayoutToolbar` is only ever rendered from `AgentsApp` (`src/App.tsx:683`), never from `IdeWindowApp`. `IdeWindowApp`'s own `MenuBar`/`menuRegistry` has no "switch to Agents" command either (`grep -in "agents.*window\|switch.*agent" src/features/menu-bar/menuRegistry.ts` — no hits). So, **today, before any change proposed here**, there is no UI affordance in the IDE window to return to the Agents window — the dead `onAgentsWindow` prop was never wired to anything real even before this cleanup; removing it changes nothing observable because it already did nothing observable. (This is a pre-existing UX gap, not something this deletion causes — flagged separately, not fixed here, since fixing it would be a product change outside a redundancy audit's remit.)
- `sidePaneOpen`/`projectName`: not read anywhere downstream; purely decorative-looking props that were never wired to any visual state in the current `TitleBar` body.

**Tests.** `tests/unit/bffRagUiApp.test.tsx` (one of the two known-baseline-red test files) mocks `TitleBar` to `() => <div>TitleBar</div>` (line 124-125) and separately mocks `openIdeWindow` (line 12, 117) only so that `App.tsx`'s *other* call sites to it (the effect-driven ones, not the `TitleBar`-routed one) don't throw during render — the mock is never asserted on (`grep -n "openIdeWindow" tests/unit/bffRagUiApp.test.tsx` shows only the declaration and the mock wiring, zero `expect(openIdeWindow)` assertions). No test exercises the dead-prop path at all; removing it cannot change this test's outcome (which is already red for unrelated reasons per the brief's known baseline).

**Blast radius.** Deleting these six interface fields, the two dead destructured aliases, and the nine dead prop-passing lines in the two call sites (`App.tsx` and `IdeWindowApp.tsx`) removes ~20 lines across three files and changes zero observable behavior — confirmed above, every real behavior these props appeared to wire up is already delivered through an independent path. Nothing downstream references `TitleBarProps.onIdeWindow`/`.sidePaneOpen`/`.projectName`/`.onOpenSettings`/`.onAgentsWindow`(on `TitleBar`, not `LayoutToolbar`)/`.onOpenTerminal`(same caveat) — confirmed by the single-consumer grep above. The one thing to watch: `LayoutToolbarProps` (a **separate**, same-file interface at `TitleBar.tsx:328-338`) happens to reuse the names `onAgentsWindow` and `onOpenTerminal` for fields that **are** live and read inside `LayoutToolbar`'s own body (lines 389-391, 404-414) — a future editor must not delete those by pattern-matching on the field name alone. The module below scopes the diff to `TitleBarProps` and its two call sites specifically to avoid that trap.

**Proposed module — "Retire pre-multi-window TitleBar props."**
- *Goal:* `TitleBarProps` only declares fields `TitleBar` actually reads.
- *Deletes:*
  - `src/components/TitleBar.tsx:16-30` — remove `projectName`, `onOpenSettings`, `onIdeWindow`, `sidePaneOpen`, `onAgentsWindow`, `onOpenTerminal` from `TitleBarProps` (keep `variant`, `onToggleSidePane`, `canGoBack`, `canGoForward`, `onGoBack`, `onGoForward`).
  - `src/components/TitleBar.tsx:41-42` — remove the `onAgentsWindow: _onAgentsWindow` / `onOpenTerminal: _onOpenTerminal` destructures.
  - `src/App.tsx:637-638,640,642` — remove `projectName`, `onOpenSettings`, `onIdeWindow`, `sidePaneOpen` props from the `<TitleBar>` call (keep `variant`, `onToggleSidePane`, `canGoBack`, `canGoForward`, `onGoBack`, `onGoForward`).
  - `src/components/windows/IdeWindowApp.tsx:57,59-63` — remove `projectName`, `onOpenSettings`, `onAgentsWindow`, `onOpenTerminal` props from the `<TitleBar>` call (keep `variant="ide"`); this also removes the now-sole-use `import { openAgentsWindow }` at line 11 — grep confirms `openAgentsWindow` has no other reference inside `IdeWindowApp.tsx`, so the import goes too.
- *Untouched:* `LayoutToolbarProps` and `LayoutToolbar` (same file, different interface — do not touch, per the trap noted above); `src/features/windows/openAppWindow.ts` (all three exported functions stay — `openIdeWindow`/`openAgentsWindow` remain genuinely used elsewhere); `services/**`.
- *"Nothing breaks" gate:* `npm run typecheck; echo "exit: $?"` → 0 (removing unused-but-typed fields cannot introduce a type error; adding a stray reference to a removed field would). `npm test` — no new failures against the current baseline (the 10 known-red tests stay exactly as red; `tests/unit/bffRagUiApp.test.tsx`'s `TitleBar`/`openIdeWindow` mocks are untouched by this change and don't need updating, since they mock the whole module/function, not individual props). Manual: open the Agents window and the IDE window in dev (`npm run tauri` or `npm run dev:desktop`) and confirm Settings still opens from both, and the sidebar toggle still works in Agents — this is the one path (`onToggleSidePane`) in the same interface that *is* live and must keep working unchanged.

**Design decision this reflects.** The product moved from a single window with an in-window IDE toggle to Cursor-style separate OS windows sometime before this audit; nobody went back and deleted the old toggle's plumbing once the new `openIdeWindow()`/`openAgentsWindow()` window-manager functions took over. That's the whole story — there is no larger IDE-removal to trace, because the IDE was never removed, only re-platformed onto a second window.

*(No other IDE-shaped residue was found on manual trace: `useLayoutStore` — the spec's suggested suspect for "layout/resize/dock state for a pane that no longer exists" — is shared, live infrastructure used by seven non-IDE files (`useShellEvents.ts`, `registerDefaultCommands.ts`, `StatusBar.tsx`, `AppShell.tsx`, `BottomPanel.tsx`, `AIPanelHeader.tsx`, `useKeyboardShortcuts.ts` — confirmed via `grep -rl "useLayoutStore" src/`), not IDE-only residue; `AgentsDockKind`/`agentsDock` state and the `SETTINGS_SECTIONS` set are both exercised by live, non-IDE code paths. No IDE-only CSS selectors exist (`grep -n "ide" src/index.css` after excluding false-positive substrings like "side"/"guide"/"hide" returns nothing). No Tauri command or `tauri.conf.json` window entry is IDE-specific — the IDE window is created dynamically via `WebviewWindow` from TypeScript, not declared statically, and `tauri.conf.json` only declares the one `"main"` window.)*

**Cross-reference to the design review.** F-U3 (`DESIGN-REVIEW-2026-09-12.md`) separately flags `AgentWorkflow.tsx`'s IDE/coding-agent-shaped category taxonomy (`read`/`write`/`edit`/`terminal`/`git`) as conceptually stale residue *inside otherwise-live code* — not dead by this audit's criteria (it has real callers), so it does not appear as a `dead` or `ide-leftover` finding here. See §3 (Findings from the frontend sweep) for whether it also qualifies as `convoluted`.

---

## 2. Findings from the parallel sweeps

*(Populated once the backend-services, frontend, and misc/scripts sweeps return. Placeholder.)*

---

## 3. `keep` list

*(Placeholder — populated with items that looked dead but proved live, so nobody re-audits them.)*

---

## 4. Grouping into modules

*(Placeholder.)*

---

## 5. Order

*(Placeholder.)*

---

## Appendix — Not yet verified

*(Candidates that got fewer than all four checks. Placeholder.)*
