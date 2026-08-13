# Lens User Guide

## Getting started

1. Launch Lens.
2. Open or import a project from the Top Bar / Projects view.
3. Use the Activity Bar (left) to switch Explorer, Search, Source Control, and Debug stubs.
4. Toggle AI with **Ctrl+L**, Terminal with **Ctrl+J** / **Ctrl+\`**, Settings with **Ctrl+,**.

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+Shift+P | Command palette |
| Ctrl+P | Quick open files |
| Ctrl+Shift+F | Global search |
| Ctrl+Shift+G | Source Control |
| Ctrl+Shift+E | Explorer |
| Ctrl+B | Toggle primary sidebar |
| Ctrl+L | Toggle AI panel |
| Ctrl+J / Ctrl+\` | Toggle bottom panel |
| Ctrl+, | Settings |
| Escape | Close overlay |

Full list: Settings → Keyboard.

## Workspaces

- Switch recent projects from the Top Bar project picker.
- Projects view lists recent workspaces with import/new actions.
- Layout sizes and open panels restore after restart.

## AI features

- Modes: Agent / Ask / Edit (AI panel header).
- Mentions via `@` in the composer.
- Conversations persist per project locally.
- Configure providers & models in Settings → Providers / Models / AI.

## Terminal

- Bottom panel → Terminal tab.
- Multi-session tabs, splits, search, and Problems / Output / Logs channels.
- Default shell and renderer: Settings → Terminal.

## Git workflow

- Activity Bar → Source Control (Ctrl+Shift+G).
- Stage/unstage changes, commit message, branch switch, remotes, history, conflicts (mock-backed in this build).
- Status Bar shows branch, ahead/behind, and change count.

## Settings

Open with Ctrl+, or the gear on the Activity Bar.

- Search settings (fuzzy)
- Favorites & recent sections
- Import / export / restore defaults (About)
- Appearance theme live-applies

Deep links: `#settings/appearance`, `#settings/providers`, etc.

## Troubleshooting

| Issue | Try |
|-------|-----|
| Blank panel | Click **Try again** on the error boundary, or reload the window |
| Offline banner | Restore network; provider tests need connectivity |
| Theme stuck | Settings → Appearance → System / Dark / Light |
| Lost chat | Chats persist per project id; switching projects loads that thread |
| Build fails | Run `npm run validate` and check TypeScript errors |

## FAQ

**Is this Cursor?** No — Lens aims for Cursor-class UX with Lens branding and a modular architecture.

**Are API keys safe?** Keys are stored locally and redacted from logs. OS keychain encryption is planned; treat this machine as trusted.

**Do providers call real APIs?** Connection tests are simulated in this build; wiring live providers is on the roadmap.
