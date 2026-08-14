# Lens Desktop

Professional desktop IDE shell built with **Tauri 2 + React 19**, designed for Cursor-class UX with Lens branding.

## Quick start

```bash
npm install
npm run tauri dev
```

Frontend only: `npm run dev`

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run build` | Typecheck + production bundle |
| `npm run bootstrap` | Verify the pinned, sovereign dependency-mirror build inputs |
| `npm run generate` | Run contract generation when the contract workspace is present |
| `npm run build -- --module M00` | Build the selected platform module (M00 build spine) |
| `npm run test-contract -- --module M00` | Run the selected module's contract gate |
| `npm run test-integration -- --module M00` | Run the selected module's integration gate |
| `npm run verify` | Run the clean M00 build-spine verification gate |
| `npm run test` | Unit + integration tests |
| `npm run lint` | ESLint |
| `npm run validate` | Full quality gate |
| `npm run tauri build` | Native installer |

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Design System](docs/DESIGN_SYSTEM.md)
- [User Guide](docs/USER_GUIDE.md)
- [Contributing](docs/CONTRIBUTING.md)
- [Release Checklist](docs/RELEASE_CHECKLIST.md)
- [Changelog](docs/CHANGELOG.md)

## License

Private / proprietary unless otherwise stated.
