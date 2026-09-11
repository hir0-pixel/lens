import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const lock = "package-lock.json";
const original = readFileSync(lock, "utf8");

writeFileSync(lock, original.replaceAll("https://npm-mirror.build.internal/", "https://registry.npmjs.org/"));
try {
  execSync("npm ci --registry=https://registry.npmjs.org/ --prefer-online --ignore-scripts", { stdio: "inherit" });
} finally {
  writeFileSync(lock, original);
}
