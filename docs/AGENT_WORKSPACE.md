# Lens Agent Workspace

Lens is an **AI-native software engineering workspace**. The Agent is the primary surface; the editor, browser, terminal, git, and logs are tools around it.

## Minimal default chrome

On load (layout store v6): **top bar + Agent + status bar only**.

| Surface | Default | Summon |
|---------|---------|--------|
| Navigator / rail | Hidden | `Ctrl+Shift+E`, `+` menu → Explorer |
| Tools pane | Hidden | `Ctrl+L`, `Ctrl+P` (file), `+` menu, command palette |
| Utility (terminal) | Hidden | `` Ctrl+` ``, `Ctrl+J` |

Closing a tools pane (`×`) sets `toolsOpen: false` — grid track collapses to `0` with `--duration-slow` transition. Context chips removed; branch / errors / active file live on the status bar.

## Empty / new-session view

When no messages yet, `App` renders `EmptySessionView`. Sessions live in `sessionStore` (`lens-session-v1`):

| Session type | UI |
|--------------|-----|
| empty (0 messages) | Centered empty home |
| `agent-only` | Full-bleed agent chat — **no** file tree / editor / terminal |
| `coding` | Full `AppShell` (tools open on demand) |

Upgrade to `coding` happens automatically on file open, IDE, terminal, or Agent/Edit file writes — animated over `--duration-slow` (320ms).

```text
┌────┬──────────┬────────────────────────────┬──────────────────┐
│Rail│ Navigator│     Agent Workspace        │  Tools Workspace │
│48px│  ~260px  │     (primary · 1fr)        │  ~420px · dock   │
│    │          │  session · plan · review   │  editor/browser/ │
│    │ agents   │  transcript · chips        │  terminal/git/…  │
│    │ projects │  composer                  │                  │
├────┴──────────┴────────────────────────────┴──────────────────┤
│              Utility panel (slim 28px default)                │
│              Problems · Output · Terminal · Ports · Logs      │
└───────────────────────────────────────────────────────────────┘
│                         Status bar                            │
└───────────────────────────────────────────────────────────────┘
```

CSS grid tracks: `48px | var(--nav-w) | minmax(0,1fr) | var(--tools-w)` × `1fr | var(--bottom-panel-h)`.

## Component hierarchy

```text
AppShell
├── WorkspaceNavRail
├── WorkspaceNavigator
├── AgentWorkspace → AIPanel
│   ├── AIPanelHeader (session + Agent/Ask/Edit)
│   ├── AgentPlanPanel
│   ├── ReviewChangesPanel
│   ├── ChatWindow
│   ├── ContextChips
│   └── AIComposer
├── ToolsWorkspace
│   ├── tool kind tabs (editor, browser, terminal, git, …)
│   └── OutputTabs | SourceControlPanel | stubs
├── BottomPanel (UtilityPanel)
└── StatusBar
```

## Docking / resize

| Region | Store fields | Sass | Clamp |
|--------|--------------|------|-------|
| Navigator | `navWidthPx`, `navOpen` | left of agent | 180–480px |
| Tools | `toolsWidthPx`, `toolsCollapsed` | left of tools | 280–~55vw; rail 40px |
| Utility | `bottomPanelHeightPx`, `bottomPanelSlim` | top of bottom | 120–70vh; slim 28px |

Persist: Zustand `lens-layout` **v5**. Drag skips CSS transitions (`workbench-grid-dragging`).

## State management

`src/stores/layoutStore.ts`:

- `navView` — agents | search | projects | memory | …
- `toolsOpen` / `toolsCollapsed` / `activeToolsTab`
- Compat aliases (`toggleAiPanel` → `toggleTools`) for older commands

## Shortcuts

| Keys | Action |
|------|--------|
| Ctrl+B | Toggle navigator |
| Ctrl+L | Toggle tools |
| Ctrl+J / `` Ctrl+` `` | Toggle utility panel |
| Ctrl+I | Focus agent composer |

File open (`lens:open-file`) calls `openTools("editor")`.

## shadcn/ui usage

Tooltip, ScrollArea, Input, DropdownMenu, Tabs, Button, Sheet (conversation history).

## Motion

`--duration-*` + `--ease-*` on panel grid, list enter (`animate-cursor-fade`), composer streaming border, thinking glow.

## Accessibility

- Focus-visible rings on rail/nav/tool controls
- `aria-pressed` / `role="tablist"` on navigators
- Panel sashes keyboard-focusable separators
- Truncation + native `title` tooltips on labels

## Performance

- Monaco / xterm remain code-split
- Tools panel can collapse to rail without unmounting agent
- Utility slim mode avoids mounting heavy terminal until expanded

## Build verification

```bash
npm run typecheck
npm run build
```
