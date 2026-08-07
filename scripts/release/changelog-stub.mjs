#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const changelogPath = path.join(root, "docs", "CHANGELOG.md");
const date = new Date().toISOString().slice(0, 10);

const stub = `## [${pkg.version}] - ${date}

### Added
- Production readiness: error boundaries, diagnostics logger, offline detection
- Testing infrastructure (Vitest) and release validation scripts

### Changed
- Bundle code-splitting via Vite manualChunks
- Accessible Modal focus trap

### Security
- CSP enabled in Tauri config
- Markdown link URL sanitization
- Secret redaction in application logs

`;

if (!existsSync(changelogPath)) {
  writeFileSync(
    changelogPath,
    `# Changelog\n\nAll notable changes to Orchids Desktop are documented here.\n\n${stub}`,
  );
} else {
  const existing = readFileSync(changelogPath, "utf8");
  if (!existing.includes(`## [${pkg.version}]`)) {
    writeFileSync(
      changelogPath,
      existing.replace(
        "# Changelog\n",
        `# Changelog\n\n${stub}`,
      ),
    );
  }
}

console.log(`Changelog stub ensured for v${pkg.version}`);
