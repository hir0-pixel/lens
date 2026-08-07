# Performance benchmarks (placeholder)

Track startup and interaction metrics via `perf` marks in `shared/diagnostics/perf.ts`.

## Targets

| Metric | Target |
|--------|--------|
| First paint (dev) | < 2.5s on mid laptop |
| Settings open | < 100ms perceived |
| Panel resize | 60 FPS |
| Main bundle (gzip) | Continuously reduce via manualChunks |

## Profiling

1. Chrome DevTools Performance while `npm run tauri dev`
2. Compare `logger` / `perf.getHistory()` after cold start
3. Record before/after when changing chunking or lazy boundaries
