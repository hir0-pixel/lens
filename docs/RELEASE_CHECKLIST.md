# Release Checklist

See also: `npm run release:checklist`

## Version bump

1. `package.json` version
2. `src-tauri/tauri.conf.json` version
3. `src-tauri/Cargo.toml` version
4. `docs/CHANGELOG.md` entry (`npm run changelog:stub` then edit)

## Gates

```bash
npm run validate
npm run lint
```

## Manual smoke (15 min)

- [ ] Cold start → workbench paints without console errors
- [ ] Ctrl+, settings search + theme switch
- [ ] AI send message + new chat
- [ ] Ctrl+J terminal session
- [ ] Ctrl+Shift+G source control stage/commit (mock)
- [ ] Ctrl+Shift+F search
- [ ] Resize panels; restart; layout restored
- [ ] Toggle offline (OS) → banner appears

## Package

```bash
npm run tauri build
```

## Updates

`UpdateService` is a **placeholder**. Enable `@tauri-apps/plugin-updater` before shipping auto-update.
