# CURSOR Frontend Redundancy Packet

**Agent:** A · frontend  
**Branch:** `cursor/redundancy-frontend`  
**Date:** 2026-09-12  
**Scope:** `src/`, `src-tauri/`  
**Phase:** 1 findings + 2 implementation (verified safe deletions only)

---

## Summary

| Metric | Value |
|---|---|
| Findings implemented | 1 |
| Findings kept (not dead) | 8 |
| Escalations | 2 |
| **Lines removed** | **22** |
| Files changed | 3 |
| Protected-path diffstat | *(empty — no protected paths touched)* |

### Counts by class

| Class | Found | Implemented | Escalated / kept |
|---|---|---|---|
| `ide-leftover` | 1 | 1 | 0 |
| `dead` | 0 | 0 | 0 |
| `duplicate` | 0 | 0 | 0 |
| `convoluted` | 1 | 0 | 1 (escalation) |
| `keep` | 7 | — | 7 |

### Diffstat

```
src/App.tsx                             |  5 -----
src/components/TitleBar.tsx             |  8 --------
src/components/windows/IdeWindowApp.tsx | 11 +----------
3 files changed, 1 insertion(+), 23 deletions(-)
```

### Gate results

| Gate | Before | After |
|---|---|---|
| `npm run typecheck; echo $?` | 0 | 0 |
| `npm run build` | 0 | 0 |
| `cargo check` (src-tauri/) | 0 | 0 |
| `npm test` — failing set | 10 (baseline red) | 10 (no new failures) |

### Before / after failing-test sets

**Before (baseline):**
- `tests/e2e/ragChat.test.ts` ×8
- `tests/unit/bffRagUiApp.test.tsx` ×2 (`s.canGoBack is not a function` — mock gap, unrelated to TitleBar)

**After:** identical — no new failures, no fixes to baseline-red tests.

---

## Design patterns applied

| Pattern | Source | Why it fits | Landing site |
|---|---|---|---|
| Interface Segregation Principle (narrow component contracts) | [SOLID — Interface Segregation](https://en.wikipedia.org/wiki/Interface_segregation_principle) | `TitleBarProps` declared six fields the component never read; consumers were misled into passing wiring that had zero render effect | `src/components/TitleBar.tsx` — `TitleBarProps` trimmed to fields actually destructured |
| Unused-props elimination | [eslint-react `no-unused-props`](https://eslint-react.xyz/docs/rules/no-unused-props) | Same rule the audit doc implies: declared-but-never-destructured props are dead API surface | `TitleBarProps` + call sites in `App.tsx`, `IdeWindowApp.tsx` |

---

## Findings

### IDE-1 — `TitleBarProps` six dead fields (IMPLEMENTED)

**Path/lines:**
- `src/components/TitleBar.tsx:16-30` (interface)
- `src/components/TitleBar.tsx:39-48` (destructuring — removed `_onAgentsWindow`, `_onOpenTerminal`)
- `src/App.tsx:636-650` (caller)
- `src/components/windows/IdeWindowApp.tsx:11,56-64` (caller + removed `openAgentsWindow` import)

**Class:** `ide-leftover`

**Static verification.**
- Read full `TitleBar` body (lines 39-93): only `variant`, `_onToggleSidePane`, `canGoBack`, `canGoForward`, `onGoBack`, `onGoForward` affect render.
- `_onAgentsWindow` and `_onOpenTerminal` were destructured with underscore aliases and never referenced again.
- `projectName`, `onOpenSettings`, `onIdeWindow`, `sidePaneOpen` were in the interface but never destructured.
- `grep -rn "TitleBar\b" --include="*.tsx" --include="*.ts" src tests` → two runtime consumers (`App.tsx`, `IdeWindowApp.tsx`) + one mock in `bffRagUiApp.test.tsx`.

**Dynamic verification.**
- Plain React props — no string/route/event registration.
- Traced each dead prop's intended behavior to live alternate paths:
  - Settings: `useShellEvents({ onOpenSettings })` in `App.tsx`; `lens:open-settings` listener in `IdeWindowApp.tsx`.
  - IDE open: `openIdeWindow()` called directly from `WorkspaceLauncher.tsx:174` and `App.tsx:252,271,489` — not via `TitleBar`.
  - Terminal: `LayoutToolbar` `onOpenTerminal` in `App.tsx:694` (live).
  - `onAgentsWindow` on `TitleBar`: never wired to UI in IDE window; `LayoutToolbar`'s live button only renders in Agents window.

**Tests.**
- `bffRagUiApp.test.tsx` mocks entire `TitleBar` module — no prop assertions.
- No test references removed props.

**Blast radius.**
- ~22 lines across 3 files; zero observable behavior change.
- **Trap avoided:** `LayoutToolbarProps.onAgentsWindow` / `.onOpenTerminal` (same file, lines 328-338) are LIVE — not touched.

**Implementation:** ✅ merged on this branch.

---

## `keep` list (looked dead, is live)

| Symbol / area | Why kept |
|---|---|
| `openIdeWindow`, `openAgentsWindow`, `openFileWindow` (`src/features/windows/openAppWindow.ts`) | Live window manager — 5+ call sites in `App.tsx`, `WorkspaceLauncher.tsx` |
| `IdeWindowApp` | Live separate OS window; routed from `App.tsx` when `?window=ide` |
| `FileEditorWindowApp` | Live; routed when `?window=file-editor` |
| `LayoutToolbar` + `LayoutToolbarProps` | Live toolbar in Agents window; `onAgentsWindow`/`onOpenTerminal` read in body |
| `useLayoutStore` | Shared by 7+ non-IDE files (`AppShell`, `BottomPanel`, `useKeyboardShortcuts`, etc.) |
| `tauri.conf.json` single `"main"` window | IDE/file windows created dynamically via `WebviewWindow` — by design, not leftover |
| `src-tauri/src/lib.rs` | No IDE-specific IPC commands; grep for `ide`/`IDE` only hits unrelated Git error string |

---

## Escalations (not implemented — propose only)

### ESC-1 — IDE window has no "return to Agents" affordance

**Class:** pre-existing UX gap (not caused by this deletion)  
**Detail:** `LayoutToolbar`'s "Agents Window" button (`TitleBar.tsx:382-396`) only renders in Agents variant. `IdeWindowApp` passes no `LayoutToolbar`. Dead `onAgentsWindow` on `TitleBar` was never a working path.  
**Recommendation:** Product change — add `LayoutToolbar variant="ide"` to `IdeWindowApp` if desired. Out of redundancy-audit remit.

### ESC-2 — `AgentWorkflow.tsx` IDE-shaped category taxonomy

**Class:** `convoluted` (live code, not dead)  
**Cross-ref:** DESIGN-REVIEW F-U3 — `read`/`write`/`edit`/`terminal`/`git` categories may be conceptually stale inside otherwise-live workflow UI.  
**Recommendation:** Design-review item; do not delete without product sign-off.

---

## Sweep notes (no additional verified deletions)

- Traced `openIdeWindow` → `IdeWindowApp` → `tauri.conf.json` → `src-tauri/src/`: no static IDE window def, no dead Rust IPC handlers.
- Prior WIP commit `e9f1388` removes the same three files/lines; independently re-verified all four checks before applying (not copied blindly).
- `src/` grep for IDE-only CSS (`grep ide src/index.css` excluding false positives): none.
- No additional candidates passed four-way verification in frontend scope without touching protected paths.

---

## Protected-path diffstat

```
(empty)
```

---

## Manual verification checklist (post-merge)

- [ ] Agents window: sidebar toggle, undo/redo in title bar still work
- [ ] Agents window: Settings opens via menu/shortcut
- [ ] IDE window: opens from WorkspaceLauncher; Settings via `lens:open-settings`
- [ ] Terminal still opens via `LayoutToolbar` in Agents window
