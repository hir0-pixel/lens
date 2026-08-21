import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function runCheck(args: string[]) {
  return execFileSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
  });
}

describe("Track 0 production build security gate", () => {
  it("passes the production security gate for the sovereign runtime surface", () => {
    const script = path.join(ROOT, "scripts", "security", "production-build-check.mjs");
    const result = runCheck([script]);
    expect(result).toContain("Production build security gate passed");
  });

  it("forbids runtime egress to public destinations in the network policy", () => {
    const policy = JSON.parse(
      readFileSync(path.join(ROOT, "platform", "network", "egress-policy.json"), "utf8"),
    );
    expect(policy.defaultDeny).toBe(true);
    expect(policy.publicDns).toBe("forbidden");
    expect(policy.publicIp).toBe("forbidden");
    expect(policy.proxy).toBe("forbidden");
    expect(policy.webhooks).toBe("forbidden");
    expect(policy.runtimeAllowedDestinations).toEqual([]);
    expect(policy.enforcement.resolve).toBe("internal-zones-only");
  });

  it("declares the internal workload allowlist without external model or search endpoints", () => {
    const policy = JSON.parse(
      readFileSync(path.join(ROOT, "platform", "network", "egress-policy.json"), "utf8"),
    );
    const allowlist = policy.allowedInternalServices as string[];
    expect(allowlist.length).toBeGreaterThan(0);
    for (const entry of allowlist) {
      expect(entry).toMatch(/\.internal$/);
      expect(entry).not.toMatch(/googleapis|openai|huggingface|anthropic|openrouter/i);
    }
  });

  it("routes the production internal RAG path only through the Orchestrator", () => {
    const serverIndex = readFileSync(path.join(ROOT, "server", "src", "index.ts"), "utf8");
    const serverConfig = readFileSync(path.join(ROOT, "server", "src", "config", "index.ts"), "utf8");
    const apiRoutes = readFileSync(path.join(ROOT, "server", "src", "routes", "api.ts"), "utf8");
    expect(serverIndex).toContain("OrchestratorClient");
    expect(serverIndex).not.toContain("LocalRagClient");
    expect(serverConfig).toContain("ORCHESTRATOR_URL");
    expect(serverConfig).toContain("ORCHESTRATOR_TOKEN");
    expect(serverConfig).toMatch(/RAG_PROVIDER_MODE === "internal"/);
    expect(serverConfig).not.toContain("gemini-test");
    expect(serverConfig).not.toMatch(/RAG_SERVICE_URL:\s*z\./);
    expect(serverConfig).not.toMatch(/RAG_SERVICE_TOKEN:\s*z\./);
    expect(apiRoutes).not.toContain('"/generate"');
  });

  it("keeps the sovereign provider surface free of public provider endpoints", () => {
    const providerStore = readFileSync(path.join(ROOT, "src", "stores", "providerStore.ts"), "utf8");
    const providersPage = readFileSync(path.join(ROOT, "src", "features", "settings", "sections", "ProvidersSettingsPage.tsx"), "utf8");
    const externalPattern = /openai|anthropic|googleapis|openrouter|huggingface|azure|ollama|gemini/i;
    expect(providerStore).toContain("Lens Sovereign");
    expect(providerStore).toContain("Platform-managed");
    expect(providerStore).not.toMatch(externalPattern);
    expect(providersPage).toContain("sovereign deployment");
    expect(providersPage).not.toMatch(externalPattern);
  });

  it("keeps the production readiness harness internal-only and secret-file based", () => {
    const harness = readFileSync(path.join(ROOT, "scripts", "readiness", "production-rag-load-lib.mjs"), "utf8");
    expect(harness).toContain('"/v1/chat"');
    expect(harness).toContain('"/v1/retrieve"');
    expect(harness).toContain("Workload token file");
    expect(harness).toContain("internal HTTPS");
    expect(harness).not.toMatch(/openai|anthropic|googleapis|openrouter|huggingface/i);
    expect(harness).not.toContain("/v1/lab/generate");
    expect(harness).not.toContain("--workload-token ");
  });
});

describe("Track 0 tracked-secret hygiene", () => {
  it("does not track server/.env or other runtime secret files", () => {
    const tracked = execFileSync("git", ["-C", ROOT, "ls-files"], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    const secretFiles = tracked.filter((file) =>
      /(^|\/)\.env$/.test(file) || /(\.(pem|key|pfx))$/i.test(file),
    );
    expect(secretFiles).toEqual([]);
    expect(tracked).toContain("server/.env.example");
  });

  it("keeps only explicitly synthetic fixtures in tracked backups and documents", () => {
    const tracked = execFileSync("git", ["-C", ROOT, "ls-files"], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    const trackedDbs = tracked.filter((file) => /\.(sqlite|db)$/i.test(file));
    for (const db of trackedDbs) {
      expect(db).toMatch(/backups\//);
    }
    const docs = tracked.filter((file) => /^Enterprise-RAG\/documents\//.test(file));
    for (const doc of docs) {
      expect(doc).toMatch(/\.docx$/);
    }
  });
});

describe("Track 0 Python bridge guards", () => {
  it("forces offline model resolution before any model library import", () => {
    const ragSource = readFileSync(path.join(ROOT, "Enterprise-RAG", "rag.py"), "utf8");
    const offlineIdx = ragSource.indexOf("HF_HUB_OFFLINE");
    const qdrantIdx = ragSource.indexOf("qdrant_client");
    expect(offlineIdx).toBeGreaterThanOrEqual(0);
    expect(qdrantIdx).toBeGreaterThanOrEqual(0);
    expect(offlineIdx).toBeLessThan(qdrantIdx);
  });

  it("pins Python bridge dependencies with SHA-256 hashes", () => {
    const lock = readFileSync(path.join(ROOT, "Enterprise-RAG", "requirements.lock.txt"), "utf8");
    expect(lock).toMatch(/--hash=sha256:[a-f0-9]{64}/);
    for (const dependency of ["python-dotenv", "qdrant-client", "fastembed"]) {
      expect(lock).toMatch(new RegExp(`^${dependency}==`, "m"));
    }
  });

  it("binds the demo bridge to loopback only and refuses non-loopback binding", () => {
    const apiSource = readFileSync(path.join(ROOT, "Enterprise-RAG", "api.py"), "utf8");
    expect(apiSource).toContain("RAG_BIND_HOST");
    expect(apiSource).toContain("127.0.0.1");
  });
});
