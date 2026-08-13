# Contributing to Lens Desktop

## Setup

```bash
npm install
npm run dev          # Vite frontend
npm run tauri dev    # Full desktop shell
```

## Quality gates

```bash
npm run typecheck
npm run lint
npm run test
npm run build
npm run validate     # typecheck + test + build
```

## Coding standards

1. **TypeScript strict** — no `any` without justification.
2. **Feature isolation** — new product surfaces live under `src/features/<name>`.
3. **Design tokens** — use `shared/design-system` / CSS vars; avoid raw hex for chrome.
4. **shadcn first** — prefer official `components/ui` primitives over custom widgets.
5. **Accessibility** — icon buttons need `aria-label`; dialogs need focus trap.
6. **Secrets** — never `console.log` API keys; use `logger` / `maskSecret`.
7. **No drive-by refactors** — keep PRs scoped to the phase / task.

## Commit style

Prefer short imperative subjects focused on why:

- `fix: trap focus in Settings modal`
- `perf: split vendor chunks for faster startup`
- `test: cover ValidationService import paths`

## Pull requests

- Include smoke notes (Settings, AI, Terminal, SCM).
- Ensure `npm run validate` is green.
- Document placeholders clearly if behavior is stubbed.
