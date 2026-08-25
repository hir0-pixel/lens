#!/usr/bin/env node
import { rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dist = resolve(root, "server/dist");

// The artifact directory is owned by this build. Removing it first prevents
// stale test/dev modules from surviving into a production package.
rmSync(dist, { recursive: true, force: true });

const tsc = resolve(root, "node_modules/typescript/bin/tsc");
const result = spawnSync(process.execPath, [tsc, "-p", "server/tsconfig.production.json"], {
  cwd: root,
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
