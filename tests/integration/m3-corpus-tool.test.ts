import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentHarness,
  JsonlSessionRepo,
  NodeExecutionEnv,
  TODO_CONTEXT,
} from "@earendil-works/pi-agent-core/node";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
  createSearchCorpusTool,
  resolveSearchCorpusIntent,
  searchCorpusCatalogEntry,
  type CorpusToolScope,
} from "../../services/agent-integration/corpusTool";
import { bindToolGovernance, type ToolGovernanceLogEvent } from "../../services/agent-integration/governanceBinding";
import { computeCompanyRagProfileDigest, type CompanyRagProfile } from "../../services/rag-profile/companyRagProfile";
import { RetrievalService, type RetrievalCandidate } from "../../services/retrieval/RetrievalService";

const now = 1_000;
const deadlineAt = 20_000;
const secretA = "Employee A private refund terms";
const secretB = "Employee B confidential acquisition terms";
const hash = (value: string): `sha256:${string}` => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const profile: CompanyRagProfile = {
  profileVersion: 1,
  companyId: "company-1",
  corpora: ["company-corpus"],
  connectors: [],
  chunking: { maxTokens: 512, overlapTokens: 32 },
  embeddingAdapterRef: "embedding-1",
  groundingPolicyRef: "grounding-1",
  tools: ["search_corpus"],
  retentionDays: 30,
  eligibleModelPatterns: ["model-*"],
  retrievalProfiles: { default: { corpusRef: "company-corpus", mode: "hybrid" } },
};
const scope = (subjectRef: string): CorpusToolScope => ({
  requestId: `request-${subjectRef}`,
  turnId: `turn-${subjectRef}`,
  subjectRef,
  sessionRef: `session-${subjectRef}`,
  deviceRef: `device-${subjectRef}`,
  purposeRef: "assistant",
  deadlineAt,
});

function retrievalFixture() {
  const candidates: RetrievalCandidate[] = [
    { resourceRef: "doc-a", versionRef: "doc-a-v1", chunkRef: "chunk-a", contentHash: hash(secretA), lane: "lexical", rank: 1, classificationRef: "confidential" },
    { resourceRef: "doc-b", versionRef: "doc-b-v1", chunkRef: "chunk-b", contentHash: hash(secretB), lane: "vector", rank: 2, classificationRef: "restricted" },
  ];
  const identities: string[] = [];
  const allowedBySubject: Record<string, string[]> = {
    "employee-a": ["doc-a-v1"],
    "employee-b": ["doc-b-v1"],
    "employee-none": [],
  };
  const retrieval = new RetrievalService(
    {
      authorizeOperation(input) {
        identities.push(input.subjectRef);
        return { allowed: true, decisionRef: "operation", policyRevision: 1 };
      },
      authorizeBatch(input) {
        identities.push(input.subjectRef);
        return {
          allowedRefs: allowedBySubject[input.subjectRef] ?? [],
          decisionRef: "batch",
          fence: "fence",
          revisionDigest: hash("revision"),
          policyRevision: 1,
          subjectSecurityRevision: 1,
          resourceSecurityRevisionDigest: hash("resources"),
        };
      },
    },
    {
      search: () => ({ indexGeneration: "generation-1", visibilitySequence: 1, sourceRevisionDigest: hash("sources"), candidates }),
    },
    {
      fetch: ({ resources }) => resources.map((resource) => ({
        ...resource,
        text: resource.versionRef === "doc-a-v1" ? secretA : secretB,
        citationAnchor: resource.versionRef === "doc-a-v1" ? "A:1" : "B:1",
      })),
    },
    { admit: () => ({ receipt: "audit" }) },
    {
      activeGeneration: () => ({
        indexGeneration: "generation-1",
        visibilitySequence: 1,
        sourceRevisionDigest: hash("sources"),
        ragProfileVersion: profile.profileVersion,
        ragProfileDigest: computeCompanyRagProfileDigest(profile),
      }),
    },
    () => now,
  );
  return { retrieval, identities };
}

async function executeFor(subjectRef: string, args: Record<string, unknown> = { query: "terms" }, maxOutputBytes?: number) {
  const fixture = retrievalFixture();
  const tool = createSearchCorpusTool({ retrieval: fixture.retrieval, profile, profileSelector: "default", scope: scope(subjectRef), maxOutputBytes });
  const result = await tool.execute(
    "call-1",
    args as { query: string },
    () => undefined,
    undefined,
    { invocationId: "invocation-1", operationId: "operation-1", turnId: "turn-1", getMemo: async () => undefined, setMemo: async () => undefined },
    TODO_CONTEXT,
  );
  return { ...fixture, result };
}

async function runGoverned(allowed: boolean) {
  const root = mkdtempSync(join(tmpdir(), "lens-m3-"));
  const env = new NodeExecutionEnv({ cwd: root });
  const repo = new JsonlSessionRepo({ fileSystem: env, sessionsRoot: join(root, "sessions") });
  const session = await repo.create({ id: "m3", cwd: root }, TODO_CONTEXT);
  const faux = fauxProvider({ provider: `lens-m3-${allowed}`, models: [{ id: "model" }] });
  const models = createModels();
  models.setProvider(faux.provider);
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("search_corpus", { query: "terms" }, { id: "call-1" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ]);
  const fixture = retrievalFixture();
  let retrievalCalls = 0;
  const logs: ToolGovernanceLogEvent[] = [];
  const tool = createSearchCorpusTool({
    retrieval: { retrieve: async (request, signal) => { retrievalCalls += 1; return fixture.retrieval.retrieve(request, signal); } },
    profile,
    profileSelector: "default",
    scope: scope("employee-a"),
  });
  const { harness } = await AgentHarness.create({ session, models, model: faux.getModel(), tools: [tool], systemPrompt: "M3" }, TODO_CONTEXT);
  bindToolGovernance(harness, {
    pdp: {
      decideBatch: () => ({ allowed: allowed ? ["company-corpus"] : [], fence: allowed ? { fenceId: "f", decisionId: "d", signature: "s", expiresAt: deadlineAt } : undefined }),
      consumeFence: () => undefined,
    },
    scope: { requestId: "request", callerWorkloadRef: "prime-agent", subjectRef: "employee-a", deviceRef: "device", deadlineAt },
    resolveIntent: () => resolveSearchCorpusIntent(profile, "default"),
    log: { emit: (event) => { logs.push(event); } },
    recordOutcome: () => undefined,
    now: () => now,
  });
  try {
    const lane = await harness.lane("main", TODO_CONTEXT);
    await lane.prompt("search", [], TODO_CONTEXT);
    return { retrievalCalls, logs, transcript: JSON.stringify(await session.findEntries(undefined, TODO_CONTEXT)) };
  } finally {
    await harness.close(TODO_CONTEXT);
    await repo.close(TODO_CONTEXT);
    rmSync(root, { recursive: true, force: true });
  }
}

describe("M3 corpus tool", () => {
  it("corpus.scoped-to-employee", async () => {
    const employeeA = await executeFor("employee-a");
    const employeeB = await executeFor("employee-b");
    expect(employeeA.result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining(secretA) });
    expect(JSON.stringify(employeeA.result)).not.toContain(secretB);
    expect(employeeB.result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining(secretB) });
    expect(JSON.stringify(employeeB.result)).not.toContain(secretA);
  });

  it("corpus.identity-propagates", async () => {
    const result = await executeFor("employee-a");
    expect(result.identities).toEqual(["employee-a", "employee-a"]);
  });

  it("corpus.args-cannot-widen-scope", async () => {
    const result = await executeFor("employee-a", { query: "terms", subjectRef: "employee-b", scope: "all-documents" });
    expect(result.identities).toEqual(["employee-a", "employee-a"]);
    expect(JSON.stringify(result.result)).not.toContain(secretB);
  });

  it("corpus.gated-by-pdp", async () => {
    const result = await runGoverned(false);
    expect(result.retrievalCalls).toBe(0);
    expect(result.transcript).toContain("Not permitted");
  });

  it("corpus.no-results-is-not-an-error", async () => {
    const result = await executeFor("employee-none");
    expect(result.result).toEqual({
      content: [{ type: "text", text: "No matching documents." }],
      details: { corpusRef: "company-corpus", resourceRefs: [], sources: [] },
    });
  });

  it("corpus.output-not-logged-raw", async () => {
    const result = await runGoverned(true);
    expect(result.retrievalCalls).toBe(1);
    expect(JSON.stringify(result.logs)).not.toContain(secretA);
    expect(JSON.stringify(result.logs)).not.toContain(secretB);
    const bounded = await executeFor("employee-a", { query: "terms" }, 32);
    expect(Buffer.byteLength((bounded.result.content[0] as { text: string }).text, "utf8")).toBeLessThanOrEqual(32);
  });

  it("exports a read-only catalog entry with real digests", () => {
    expect(searchCorpusCatalogEntry).toMatchObject({ toolId: "search_corpus", risk: "read" });
    expect(searchCorpusCatalogEntry.schemaDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(searchCorpusCatalogEntry.dataFlowProfileDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});
