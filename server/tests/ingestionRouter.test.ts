import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { AuditLedger } from "../../services/audit/AuditLedger";
import type { IngestionJobRecord, IngestionRequest, IngestionService, VersionRecord } from "../../services/ingestion";
import { computeCompanyRagProfileDigest } from "../../services/rag-profile/companyRagProfile";
import { simpleHash } from "../../services/retrieval/indexGenerationManifest";
import { createIngestionRouter } from "../src/routes/ingestion";
import { __resetConfig } from "../src/config";

process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "s".repeat(48);
process.env.ADMIN_SUBJECTS = "admin";

const digest = (value: string): `sha256:${string}` => `sha256:${simpleHash(value)}`;
const profile = { profileVersion: 1, companyId: "company", corpora: ["docs"], connectors: [], chunking: { maxTokens: 100, overlapTokens: 10 }, embeddingAdapterRef: "provider", groundingPolicyRef: "policy", tools: [], retentionDays: 30, eligibleModelPatterns: [], retrievalProfiles: { default: { corpusRef: "docs", mode: "hybrid" as const } } };
const body = { sourceId: "source", documentRef: "document", version: "v1", versionRef: "document@v1", contentDigest: digest("a"), aclDigest: digest("b"), classificationRef: "internal", parse: { status: "accepted", renditionDigest: digest("c"), chunks: [{ chunkRef: "chunk", contentDigest: digest("router fixture chunk"), text: "router fixture chunk", citationAnchor: "p1" }] }, ragProfileVersion: 1, ragProfileDigest: computeCompanyRagProfileDigest(profile) };

function createHarness(session: "none" | "user" | "admin" = "admin", auditHealthy = true) {
  let submitted = false;
  let ingestEnqueues = 0;
  let withdrawEnqueues = 0;
  const requestBody: IngestionRequest = { sourceId: body.sourceId, documentRef: body.documentRef, version: body.version, versionRef: body.versionRef, contentDigest: body.contentDigest, aclDigest: body.aclDigest, classificationRef: "internal", parse: body.parse };
  const version: VersionRecord = { request: requestBody, state: "QUEUED", stage: "DISCOVERED", profileRef: "default-ingestion-profile", idempotencyKey: "key" };
  const job = (): IngestionJobRecord => ({ ...version, jobId: "ingest:key", jobType: "INGEST", attemptsByStage: {}, byteSize: 1, createdAtMs: 1, updatedAtMs: 1, availableAtMs: 1, retryBudgetRemaining: 1 });
  const service = {
    enqueueIngest: async () => { ingestEnqueues += 1; submitted = true; return job(); },
    enqueueWithdraw: async () => { withdrawEnqueues += 1; return job(); },
    version: async () => submitted ? version : undefined,
  } as unknown as IngestionService;
  const auth = { getTrustedSession: async () => session === "none" ? { authenticated: false } : { authenticated: true, subject: session } } as never;
  const auditLedger = new AuditLedger({ ingestion: ["ingestion.job.submitted", "ingestion.job.withdrawn"] });
  if (!auditHealthy) auditLedger.setHealth({ quorumAvailable: false });
  const app = express(); app.use(express.json()); app.use(cookieParser()); app.use(createIngestionRouter({ auth, ingestion: { services: new Map([["docs", service]]), ragProfile: profile }, auditLedger }));
  return { client: request(app), auditLedger, get ingestEnqueues() { return ingestEnqueues; }, get withdrawEnqueues() { return withdrawEnqueues; } };
}

function harness(session: "none" | "user" | "admin" = "admin") {
  return createHarness(session).client;
}

describe("ingestion admin router", () => {
  beforeEach(() => { __resetConfig(); });
  it("gates authentication and admin access", async () => {
    expect((await harness("none").post("/corpora/docs/jobs").send(body)).status).toBe(401);
    expect((await harness("user").post("/corpora/docs/jobs").send(body)).status).toBe(403);
  });
  it("validates corpus, request, profile authority, and submits idempotently", async () => {
    expect((await harness().post("/corpora/missing/jobs").send(body)).status).toBe(400);
    expect((await harness().post("/corpora/docs/jobs").send({})).status).toBe(400);
    expect((await harness().post("/corpora/docs/jobs").send({ ...body, ragProfileVersion: 2 })).status).toBe(409);
    const first = await harness().post("/corpora/docs/jobs").send(body);
    expect(first.status).toBe(202);
    expect(first.body).toMatchObject({ jobId: "ingest:key", state: "QUEUED", stage: "DISCOVERED" });
  });
  it("withdraws a job successfully", async () => {
    const response = await harness().post("/corpora/docs/jobs/document@v1/withdraw").send();
    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({ jobId: "ingest:key", state: "QUEUED", stage: "DISCOVERED" });
  });
  it("fails closed when submit audit admission is unavailable", async () => {
    const testHarness = createHarness("admin", false);
    const response = await testHarness.client.post("/corpora/docs/jobs").send(body);
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "DEPENDENCY_UNAVAILABLE" });
    expect(testHarness.ingestEnqueues).toBe(0);
    expect(await testHarness.client.get("/corpora/docs/jobs/document@v1")).toMatchObject({ status: 404 });
  });
  it("fails closed when withdraw audit admission is unavailable", async () => {
    const testHarness = createHarness("admin", false);
    const response = await testHarness.client.post("/corpora/docs/jobs/document@v1/withdraw").send();
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "DEPENDENCY_UNAVAILABLE" });
    expect(testHarness.withdrawEnqueues).toBe(0);
  });
  it("returns submitted job status and not-found status", async () => {
    const { client } = createHarness();
    await client.post("/corpora/docs/jobs").send(body).expect(202);
    await client.get("/corpora/docs/jobs/document@v1").expect(200, {
      state: "QUEUED",
      stage: "DISCOVERED",
    });
    await createHarness().client.get("/corpora/docs/jobs/never-submitted").expect(404, { error: "NOT_FOUND" });
  });
  it("replaying a submission commits one audit entry", async () => {
    const { client, auditLedger } = createHarness();
    const first = await client.post("/corpora/docs/jobs").send(body);
    const second = await client.post("/corpora/docs/jobs").send(body);
    expect(first.body.jobId).toBe(second.body.jobId);
    const receipt = auditLedger.appendIntent({ workloadId: "ingestion", attested: true }, {
      eventId: "ingest:source:v1:default-ingestion-profile",
      partitionKey: body.versionRef,
      eventType: "ingestion.job.submitted",
      requestId: "ingest:source:v1:default-ingestion-profile",
      action: "ingestion.submit",
      intentDigest: body.contentDigest,
      byteLength: JSON.stringify(body).length,
    });
    expect(receipt.committedOffset).toBe(1);
  });
});
