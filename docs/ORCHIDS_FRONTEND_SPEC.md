# Orchids Frontend Spec v2 — Applied

## Fixed (from §0)
1. **Toolbar hierarchy** — Deploy=`btn-primary`, Import=`btn-secondary`, rest=`btn-ghost`; 40px bar, `gap-4` / `gap-2` clusters
2. **Empty/error states** — entrance animation, 64px icon badge, Try again (secondary) + Reload (primary)
3. **Hover feedback** — button system + tabs + window close (error-muted) + status segments
4. **Spacing** — `--space-*` scale; toolbar uses 4/8/12/16 only

## Tokens
`src/index.css` — v2 HSL + `--space-*`, `--border-strong`, `--text-on-accent`, `--error-muted` / `--success-muted`, button utilities `.btn-primary|secondary|ghost|link`

## Definition of Done
- [x] One primary filled button in toolbar (Deploy)
- [x] Hover/active/focus on buttons/tabs/window controls
- [x] Token-driven colors (new chrome)
- [x] Tabs max 180px, truncate + title
- [x] Error/empty animate + hierarchy
- [x] AI 3-dot thinking pulse
- [x] 4px spacing grid on rebuilt chrome
- [x] Reduced-motion media still present

## Remaining
- Full audit of older AI/settings zinc hardcodes
- Diff Accept/Reject hover motion
- Tab strip fade mask on overflow
