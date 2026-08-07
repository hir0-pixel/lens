# E2E tests (placeholder)

Use Playwright or WebdriverIO against `tauri dev` in CI once packaging is stable.

Suggested scenarios:

1. Cold start → status bar visible
2. Open Settings → change theme → persists after reload
3. AI composer send → assistant message appears
4. Terminal open → type command → output line
5. SCM stage + commit → toast
6. Global search → results list

Do not block Phase 10 release on full E2E automation; unit + integration smoke + manual checklist are the current gates.
