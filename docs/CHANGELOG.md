# Changelog

All notable changes to Orchids Desktop are documented here.

## [0.1.0] - 2026-08-06

### Added
- Phases 0–10 IDE foundation: shell, AI panel, terminal, command palette, SCM, settings, design system, production readiness
- Error boundaries, diagnostics logger, offline detection, UpdateService placeholder
- Vitest unit/integration suite and `npm run validate` quality gate
- Developer + user documentation under `docs/`

### Changed
- Vite manual chunk splitting for smaller initial payload
- Accessible Modal (focus trap, Escape, focus restore)
- Tauri window defaults (1440×900, min 1024×640) and CSP

### Security
- Secret redaction in logs
- Markdown URL sanitization
- Provider key validation helpers

### Known limitations
- Mock-backed Git, AI streaming, and provider HTTP
- Auto-update not enabled
- API keys stored in localStorage (not OS keychain)
