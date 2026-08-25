import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadApprovedCatalogFromBff } from "../../orchestrator-service/src/approvedCatalogClient.ts";
import { assertCompanyRagProfile } from "../../services/rag-profile/companyRagProfile.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
function loadEnv(path) {
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    let value = trimmed.slice(eq + 1);
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1).replace(/\\n/g, "\n");
    }
    process.env[trimmed.slice(0, eq)] = value;
  }
}
loadEnv(resolve(root, ".local/rag-stack/orchestrator.env"));
const profile = assertCompanyRagProfile(JSON.parse(process.env.LENS_COMPANY_RAG_PROFILE_JSON ?? "{}"));
const catalog = await loadApprovedCatalogFromBff({
  catalogUrl: process.env.LENS_APPROVED_CATALOG_URL,
  token: process.env.LENS_APPROVED_CATALOG_TOKEN,
  ragProfile: profile,
});
await catalog.refresh();
try {
  const resolved = catalog.resolve({ modelRef: "gemini-2.5-flash", capability: "grounded-assistant" });
  console.log("resolve ok", resolved);
  console.log("digestApproved", catalog.digestApproved({ artifactDigest: resolved.artifactDigest, capability: "grounded-assistant" }));
} catch (error) {
  console.error("resolve failed", error);
  process.exit(1);
}
