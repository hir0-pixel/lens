# Lens Desktop — Architecture

Feature-based React + Tauri **Agent Workspace** — AI-first shell with tools (editor, browser, terminal) as secondary surfaces.

## Stack

- **Desktop:** Tauri 2 (Rust shell)
- **UI:** React 19 + Vite 7 + Tailwind CSS + shadcn/ui (Radix)
- **State:** Zustand (+ persist middleware)
- **Terminal:** xterm.js
- **Markdown:** react-markdown + remark-gfm

## Shell regions

```text
NavRail | Navigator | AgentWorkspace (primary) | ToolsWorkspace
                      UtilityPanel (bottom, slim by default)
                      StatusBar
```

See [AGENT_WORKSPACE.md](./AGENT_WORKSPACE.md) for layout, docking, and hierarchy.

## Layering

```text
src/
  components/     # Shell chrome + shared UI primitives
  components/workspace/  # NavRail, Navigator, AgentWorkspace, ToolsWorkspace
  features/       # Feature modules (settings, SCM, palette, search)
  stores/         # Zustand stores (layout v5, git, terminal, settings, …)
  shared/         # Cross-cutting (design-system, diagnostics, security, fuzzy)
  lib/            # App-level types + mock data
```

## Boundaries

| Layer | May depend on |
|-------|----------------|
| features/* | stores, shared, components/ui |
| components/shell | stores, features, workspace (thin wiring) |
| components/workspace | stores, ai, output, features |
| stores | shared only |
| shared | nothing above itself |

## Persistence map

| Store / key | Persists |
|-------------|----------|
| `lens-layout` v5 | Nav/tools/utility sizes, collapse, navView, tools tab |
| `lens-settings` | Settings categories, favorites, search history |
| `lens-appearance` | Theme, accent, density, a11y flags |
| `lens-providers` | Provider configs + models |
| `lens-git` | SCM UI state (mock repo selection) |
| `lens-terminal` | Session metadata |
| `lens-conversations` | Agent threads per project (bounded) |

## Diagnostics

- `logger` — ring buffer + secret redaction
- `perf` — startup / path marks
- `network` — online/offline + fetchWithTimeout
- Global `error` / `unhandledrejection` handlers in `main.tsx`
- React `ErrorBoundary` at app + workspace + agent

## Performance

- Vite `manualChunks` for react, radix, xterm, markdown, icons
- Lazy settings sections + Project/Analytics views
- Virtual window helper for large lists (`shared/performance/virtualWindow.ts`)

## Security

- Tauri CSP enabled
- Markdown URLs sanitized (`sanitizeUrl`)
- API keys redacted in logs; validated via `isPlausibleApiKey`
- Keys remain in localStorage for UX — OS keychain encryption is Phase 11+
