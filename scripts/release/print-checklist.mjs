#!/usr/bin/env node
const checklist = `
# Orchids Release Checklist (v0.1.0)

## Pre-release
- [ ] npm run validate passes (typecheck + tests + build)
- [ ] npm run lint has no errors
- [ ] Manual smoke: open workspace, AI chat, terminal, SCM, settings, search
- [ ] Theme dark/light/system switches cleanly
- [ ] Settings import/export round-trips
- [ ] Offline banner appears when network is disabled
- [ ] Window min size respected (1024×640)
- [ ] API keys never appear in console logs
- [ ] CHANGELOG.md updated
- [ ] Version bumped in package.json + src-tauri/tauri.conf.json + Cargo.toml

## Packaging
- [ ] tauri build succeeds for target OS
- [ ] Installer launches and opens Orchids
- [ ] Icons render correctly
- [ ] CSP does not block critical resources
- [ ] Updater placeholder documented (UpdateService)

## Post-release
- [ ] Tag git release (vX.Y.Z)
- [ ] Attach artifacts to GitHub Release
- [ ] Verify download + first-run experience
`;

console.log(checklist.trim());
