# B3 — Accessibility as a binding requirement (F-A1 + F-A2 token fix)

Status: automated definition of done passes. Closes backlog item B3 and design-review findings F-A1 (doc) and F-A2 (tertiary contrast token).

## Scope

- `lens-agent-integration/ACCESSIBILITY-REQUIREMENT.md` — exact text to add to Doc 001 §10 (WCAG 2.2 AA binding NFR, four sub-rows, contrast gate).
- `tests/unit/paletteContrast.test.ts` — hold `a11y.palette-contrast-aa` (WCAG relative-luminance formula; seeded F-A2 failure documented).
- `DESIGN-lens.md` — tertiary ratified `#6E6A62` (was `#A09C92`, 2.55:1 on `#F7F7F4`).
- `src/shared/design-system/cursorTokens.ts` — informational tertiary/inactive/placeholder fg aligned to `#6E6A62` (scrollbar slider stays decorative `#A09C92`).
- `src/index.css`, `src/shared/themes/themeManager.ts` — light `--text-tertiary` / `--text-disabled` only set to `#6E6A62`; secondary, border, and scrollbar `#818581` values untouched; dark theme out of scope.
- `tests/unit/tokens.test.ts` — approved palette updated for `#6e6a62`.

## Diff checks

```text
git diff --stat
 DESIGN-lens.md                           |  4 ++--
 src/index.css                            |  4 ++--
 src/shared/design-system/cursorTokens.ts | 10 +++++-----
 src/shared/themes/themeManager.ts        |  4 ++--
 tests/unit/paletteContrast.test.ts       | ...
 tests/unit/tokens.test.ts                |  3 ++-

git diff --stat -- services/pdp services/agent-integration contracts services/secrets
(no output)
```

New files (untracked before commit):

```text
lens-agent-integration/ACCESSIBILITY-REQUIREMENT.md
lens-agent-integration/B3-A11Y-PACKET.md
tests/unit/paletteContrast.test.ts
```

## Automated evidence

Run on 2026-09-12 from `/Users/rameelmalik/Documents/Lens/lens-wt-b3-a11y` (branch `codex/b3-a11y`):

```text
npm run typecheck
exit 0

npm test
Test Files  2 failed | 85 passed (87)
Tests       2 failed | 437 passed (439)
exit 1
```

No new failures vs parent baseline. Known-red unchanged:

- `tests/e2e/ragChat.test.ts` — suite fails to load (`cookie-parser` resolution; 8 tests in suite)
- `tests/unit/bffRagUiApp.test.tsx` — 2 tests (`s.canGoBack is not a function`)

New hold passes; no regressions in previously green tests.

### Named holds

```text
npx vitest run tests/unit/paletteContrast.test.ts
 ✓ a11y.palette-contrast-aa > documents the F-A2 seed failure (#A09C92 on #F7F7F4 = 2.55:1)
 ✓ a11y.palette-contrast-aa > ratified light informational pairs from DESIGN-lens.md meet WCAG 2.2 AA (4.5:1)
 ✓ a11y.palette-contrast-aa > ratified tertiary #6E6A62 on canvas #F7F7F4 passes AA (~5:1)
Test Files  1 passed (1)
Tests       3 passed (3)
exit 0

npx vitest run tests/unit/tokens.test.ts
Test Files  1 passed (1)
Tests       6 passed (6)
exit 0
```

Ratified tertiary `#6E6A62` on canvas `#F7F7F4` = **5.02:1** (WCAG AA pass; was 2.55:1 at `#A09C92`).

## Protected paths

`git diff --stat -- services/pdp services/agent-integration contracts services/secrets` — empty. Confirmed.
