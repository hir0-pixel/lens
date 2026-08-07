#!/usr/bin/env node
/**
 * Production quality gate — typecheck, unit tests, production build.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function run(label, cmd, args) {
  console.log(`\n▶ ${label}`);
  const result = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    shell: true,
  });
  if (result.status !== 0) {
    console.error(`✗ Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
  console.log(`✓ ${label}`);
}

console.log("Orchids production validation");
console.log(`Root: ${root}`);

if (!existsSync(path.join(root, "package.json"))) {
  console.error("package.json missing");
  process.exit(1);
}

run("Typecheck", "npm", ["run", "typecheck"]);
run("Unit tests", "npm", ["run", "test"]);
run("Production build", "npm", ["run", "build"]);

console.log("\nAll quality gates passed.");
