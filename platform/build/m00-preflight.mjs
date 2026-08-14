#!/usr/bin/env node
/** M00 Engineer A gate: validate the build-spine controls that are locally testable. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const requiredFiles = [
  "package-lock.json",
  ".npmrc",
  "platform/build/dependency-mirrors.json",
  "platform/build/provenance-placeholder.json",
  "platform/build/service-template/build-contract.json",
  "platform/build/service-template/Dockerfile.template",
  "platform/build/ci/isolated-build.yaml",
];

function fail(message) {
  console.error(`M00 preflight: ${message}`);
  process.exit(1);
}

for (const file of requiredFiles) {
  if (!existsSync(path.join(root, file))) fail(`required file is missing: ${file}`);
}

const mirrors = JSON.parse(readFileSync(path.join(root, "platform/build/dependency-mirrors.json"), "utf8"));
if (
  mirrors.allowPublicFallback !== false ||
  mirrors.npm?.immutableArtifacts !== true ||
  !/^https:\/\/[^/]+\.internal\/$/.test(mirrors.npm?.registry ?? "") ||
  mirrors.container?.digestOnlyPulls !== true ||
  mirrors.policy?.network !== "deny-by-default" ||
  mirrors.policy?.publicResolvers !== "forbidden"
) fail("dependency mirror policy is incomplete or permits a public resolution path.");

const npmConfig = readFileSync(path.join(root, ".npmrc"), "utf8");
for (const requiredSetting of [
  `registry=${mirrors.npm.registry}`,
  "audit=false",
  "fund=false",
  "update-notifier=false",
  "prefer-offline=true",
  "strict-ssl=true",
]) {
  if (!npmConfig.includes(requiredSetting)) {
    fail(`npm configuration is missing sovereign setting: ${requiredSetting}`);
  }
}

const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));
for (const [name, entry] of Object.entries(lock.packages ?? {})) {
  if (!entry?.resolved) continue;
  if (!entry.resolved.startsWith(mirrors.npm.registry)) {
    fail(`non-mirrored package resolution for ${name || "root"}: ${entry.resolved}`);
  }
  if (!entry.integrity) fail(`package is missing an integrity digest: ${name}`);
}

const service = JSON.parse(
  readFileSync(path.join(root, "platform/build/service-template/build-contract.json"), "utf8"),
);
if (
  service.serviceBoundary?.separateArtifact !== true ||
  service.serviceBoundary?.generatedContractsOnly !== true ||
  service.serviceBoundary?.crossServiceInternalImports !== false ||
  service.serviceBoundary?.crossServiceDatabaseAccess !== false ||
  service.isolatedBuild?.ephemeralSingleJobWorker !== true ||
  service.isolatedBuild?.readOnlyInputs !== true ||
  service.isolatedBuild?.noProductionCredentials !== true ||
  service.isolatedBuild?.noCrossJobWritableCache !== true ||
  service.release?.digestPinned !== true ||
  service.release?.requiresSbom !== true ||
  service.release?.requiresProvenance !== true ||
  service.release?.requiresIndependentReleaseSignature !== true ||
  service.release?.directProductionDeployment !== false
) fail("service template permits an architecture-boundary or release-control bypass.");

const ci = readFileSync(path.join(root, "platform/build/ci/isolated-build.yaml"), "utf8");
for (const requiredControl of [
  "ephemeral: true",
  "single_job: true",
  "clean_workspace: true",
  "writable_cache: forbidden",
  "production_credentials: forbidden",
  "default: deny",
  "public_dns_proxy_and_resolvers: forbidden",
  "build_worker_may_sign: false",
  "separate_release_controller_required: true",
  "direct_deployment: forbidden",
  "npm ci --ignore-scripts",
  "npm run lint",
  "npm run test",
  "platform-release-provenance --require-independent-signature",
]) {
  if (!ci.includes(requiredControl)) fail(`isolated CI lacks control: ${requiredControl}`);
}

const provenance = JSON.parse(
  readFileSync(path.join(root, "platform/build/provenance-placeholder.json"), "utf8"),
);
if (provenance.status !== "placeholder-not-a-signature") {
  fail("placeholder must never be accepted as signed release provenance.");
}

console.log("M00 Engineer A platform preflight passed.");
