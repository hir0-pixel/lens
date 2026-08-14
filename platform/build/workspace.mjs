#!/usr/bin/env node
/**
 * M00 workspace command surface.
 *
 * This intentionally contains no release signing implementation. Signing and
 * admission are separate authorities; this script only creates/validates the
 * inputs that those authorities must consume.
 */
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const command = process.argv[2] ?? "build";
const moduleIndex = process.argv.findIndex((argument) => argument === "--module");
const moduleName =
  process.env.MODULE ??
  (moduleIndex >= 0 ? process.argv[moduleIndex + 1] : undefined);

function fail(message) {
  console.error(`M00 build spine: ${message}`);
  process.exit(1);
}

function requireFile(relativePath) {
  if (!existsSync(path.join(root, relativePath))) {
    fail(`required file is missing: ${relativePath}`);
  }
}

function run(label, args) {
  console.log(`\n> ${label}`);
  // npm is a .cmd shim on Windows. `call` is required here: without it cmd
  // transfers control to npm.cmd and never returns to this runner.
  const result = process.platform === "win32"
    ? spawnSync("cmd.exe", ["/d", "/s", "/c", ["call", "npm.cmd", ...args].join(" ")], {
        cwd: root,
        stdio: "inherit",
      })
    : spawnSync("npm", args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function runNode(label, args) {
  console.log(`\n> ${label}`);
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function validateModule() {
  if (moduleName !== undefined && !["M00", "M01", "M02", "M03"].includes(moduleName)) {
    fail(`workspace supports MODULE=M00 through MODULE=M03 (received ${moduleName}).`);
  }
}

function validateM00() {
  validateModule();
  if (moduleName === "M01") fail("M01 has no shared contract gate in the Engineer A lane.");
}

function bootstrap() {
  for (const file of [
    "package.json",
    "package-lock.json",
    ".npmrc",
    "platform/build/dependency-mirrors.json",
    "platform/build/service-template/build-contract.json",
  ]) requireFile(file);

  const mirrors = JSON.parse(
    readFileSync(path.join(root, "platform/build/dependency-mirrors.json"), "utf8"),
  );
  if (mirrors.allowPublicFallback !== false || !mirrors.npm?.registry) {
    fail("dependency mirror policy must define an internal registry and deny public fallback.");
  }
  if (!mirrors.npm.registry.startsWith("https://") || !mirrors.npm.registry.includes(".internal/")) {
    fail("dependency mirror registry must be an HTTPS internal endpoint.");
  }
  const npmConfig = readFileSync(path.join(root, ".npmrc"), "utf8");
  for (const requiredSetting of [
    `registry=${mirrors.npm.registry}`,
    "audit=false",
    "fund=false",
    "update-notifier=false",
  ]) {
    if (!npmConfig.includes(requiredSetting)) {
      fail(`.npmrc is missing required sovereign setting: ${requiredSetting}`);
    }
  }

  const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));
  const packages = Object.values(lock.packages ?? {});
  const externalResolution = packages.find(
    (entry) => entry?.resolved && !entry.resolved.startsWith(mirrors.npm.registry),
  );
  if (externalResolution) {
    fail(`lockfile contains a non-mirrored dependency URL: ${externalResolution.resolved}`);
  }
  const unresolvedIntegrity = packages.find(
    (entry) => entry?.resolved && !entry.integrity,
  );
  if (unresolvedIntegrity) {
    fail("every mirrored package artifact must carry a lockfile integrity digest.");
  }

  console.log("Pinned lockfile and sovereign mirror policy are present.");
  console.log("Install resolution is intentionally delegated to the isolated build worker.");
}

function generate() {
  requireFile("platform/build/contract-generation.json");
  const spec = JSON.parse(
    readFileSync(path.join(root, "platform/build/contract-generation.json"), "utf8"),
  );
  if (!existsSync(path.join(root, spec.inputDirectory))) {
    fail(`required generated-contract input is absent: ${spec.inputDirectory}/`);
  }
  requireFile("scripts/contracts/generate.mjs");
  runNode("Contract generation", ["scripts/contracts/generate.mjs"]);
  if (!existsSync(path.join(root, spec.outputDirectory, "index.ts"))) {
    fail(`contract generator did not produce ${spec.outputDirectory}/index.ts`);
  }
}

function contractTest() {
  validateM00();
  generate();
  run("Contract registry checks", ["run", "contracts:check"]);
  run("Generated client/server contract tests", ["exec", "vitest", "--", "run", "tests/contract"]);
}

function integrationTest() {
  validateM00();
  generate();
  run("Generated client/server mTLS probe", ["exec", "vitest", "--", "run", "tests/integration/contract-probe.test.ts"]);
}

function build() {
  validateModule();
  bootstrap();
  if (moduleName === "M01") {
    run("M01 platform trust preflight", ["run", "test:m01-platform"]);
    console.log("M01 Engineer A platform baseline assembled. Shared admission, telemetry, and egress probes remain Engineer B integration inputs.");
    return;
  }
  if (moduleName === "M02") {
    run("M02 authority preflight", ["run", "test:m02-authorities"]);
    console.log("M02 Engineer A identity, session, and audit authority baseline assembled.");
    return;
  }
  if (moduleName === "M03") {
    run("M03 PDP preflight", ["run", "test:m03-pdp"]);
    console.log("M03 Engineer A PDP policy and live-decision baseline assembled.");
    return;
  }
  generate();
  run("M00 platform preflight", ["run", "test:m00-platform"]);
  run("Lens web build", ["run", "build:web"]);
  if (moduleName === "M00") console.log("M00 workspace/build-spine artifact assembled.");
}

function verify() {
  bootstrap();
  run("M00 platform preflight", ["run", "test:m00-platform"]);
  run("Generation", ["run", "generate"]);
  run("Contract registry checks", ["run", "contracts:check"]);
  run("Generated client provenance", ["run", "contracts:provenance"]);
  run("Contract gate", ["run", "test-contract"]);
  run("Typecheck", ["run", "typecheck"]);
  run("Lint", ["run", "lint"]);
  run("Unit tests", ["run", "test"]);
  run("Production build", ["run", "build:web"]);
  run("Integration gate", ["run", "test-integration"]);
  console.log("\nM00 build-spine checks passed. Release signing/admission remain external, independent gates.");
}

switch (command) {
  case "bootstrap": bootstrap(); break;
  case "generate": generate(); break;
  case "build": build(); break;
  case "test-contract": contractTest(); break;
  case "test-integration": integrationTest(); break;
  case "verify": verify(); break;
  default: fail(`unknown command: ${command}`);
}
