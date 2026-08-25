import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthorityHttpClient } from "../../orchestrator-service/src/authorityClient";
import { createAuthorityHttp, type AuthorityHttp } from "../src/http";
import { AuthorityService } from "../src/service";
import { AuthorityStore } from "../src/store";
import { OutputBlobCrypto } from "../src/outputCrypto";
import { GovernanceAuthority } from "../../services/governance/GovernanceAuthority";
import {
  DevAutoProvisioningResourceFactReader,
  DevAutoProvisioningSubjectDeviceDirectory,
  HmacFenceSigner,
  InMemoryPdpAuditPort,
  PdpBackedContextFencePolicy,
  bootstrapGenerationPdp,
} from "../src/pdpAdapter";
import { randomBytes } from "node:crypto";

const WORKLOAD_TOKEN = "a".repeat(40);

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

/** Wires the real PDP-backed policy with dev auto-provisioning sources, exactly as a real deployment would wire a real one — see pdpAdapter.ts. */
function testContextFencePolicy(governance: GovernanceAuthority, now: () => number) {
  const directory = new DevAutoProvisioningSubjectDeviceDirectory();
  const resourceReader = new DevAutoProvisioningResourceFactReader(governance, now);
  const signer = new HmacFenceSigner(randomBytes(32));
  const pdp = bootstrapGenerationPdp({ directory, resourceReader, audit: new InMemoryPdpAuditPort(), signer, now });
  return new PdpBackedContextFencePolicy(pdp, now);
}

async function startServer(dbPath: string): Promise<{ http: AuthorityHttp; store: AuthorityStore; service: AuthorityService; port: number; url: string }> {
  const store = new AuthorityStore(dbPath);
  const now = () => Date.now();
  const governance = new GovernanceAuthority(now);
  const service = new AuthorityService(store, undefined, now, testContextFencePolicy(governance, now), governance, OutputBlobCrypto.fromHex("11".repeat(32)));
  const http = createAuthorityHttp({ workloadToken: WORKLOAD_TOKEN, service, isStoreReady: () => true });
  await http.listen(0, "127.0.0.1");
  const address = http.server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind to a port");
  return { http, store, service, port: address.port, url: `http://127.0.0.1:${address.port}` };
}

describe("authority-service HTTP contract (driven by the real AuthorityHttpClient)", () => {
  let dir: string;
  let server: Awaited<ReturnType<typeof startServer>>;
  let client: AuthorityHttpClient;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "authority-http-test-"));
    server = await startServer(join(dir, "authority.db"));
    client = new AuthorityHttpClient(server.url, WORKLOAD_TOKEN);
  });

  afterEach(async () => {
    await server.http.close();
    await server.store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("full happy path: revalidate -> admit -> inspect(allow) -> putBlob -> verifyBlob -> commitTerminal -> reserve -> commit -> authorize", async () => {
    const requestId = "req-happy";
    const turnId = "turn-happy";
    const now = Date.now();
    const contextDigest = digest("context-happy");

    const fence = await client.revalidate({
      requestId,
      turnId,
      subjectRef: "subject-1",
      deviceRef: "device-1",
      sessionRef: "session-1",
      contextDigest,
      manifestExpiresAt: now + 60_000,
      boundary: "generation_start",
      resourceRefs: ["resource-happy"],
      indexGeneration: "index:1",
    }, AbortSignal.timeout(5_000));
    expect(fence.fenceRef.length).toBeGreaterThan(0);
    expect(fence.contextDigest).toBe(contextDigest);

    const admission = await client.admit({
      kind: "generation",
      requestId,
      turnId,
      inputDigest: digest("prompt-happy"),
      ragProfileVersion: 1,
      ragProfileDigest: digest("rag-profile-happy"),
    }, AbortSignal.timeout(5_000));
    expect(admission.receiptDigest).toMatch(/^sha256:[a-f0-9]{64}$/);

    const output = "This is the generated output.";
    const outputDigest = digest(output);
    const inspection = await client.inspect({
      requestId,
      subjectRef: "subject-1",
      output,
      outputDigest,
      sourceClassifications: ["internal"],
    }, AbortSignal.timeout(5_000));
    expect(inspection.allowed).toBe(true);
    if (!inspection.allowed) throw new Error("expected allow");

    const blob = await client.putBlob({
      requestId,
      turnId,
      output,
      outputDigest,
      classificationRef: inspection.derivedClassificationRef,
      guardReceipt: inspection.guardReceipt,
    }, AbortSignal.timeout(5_000));
    expect(blob.outputRef).toMatch(/^blob:/);

    const verified = await client.verifyBlob({ outputRef: blob.outputRef, outputDigest: blob.outputDigest }, AbortSignal.timeout(5_000));
    expect(verified).toBe(true);

    await client.commitTerminal({
      requestId,
      turnId,
      outputRef: blob.outputRef,
      outputDigest: blob.outputDigest,
      releaseFence: "fence:release:happy",
      releaseAuditReceipt: admission.receiptDigest,
    }, AbortSignal.timeout(5_000));

    const reservation = await client.reserve({
      requestId,
      subjectRef: "subject-1",
      deviceRef: "device-1",
      applicationRef: "lens-employee-client",
      purposeRef: "assistant",
      outputRef: blob.outputRef,
      outputDigest: blob.outputDigest,
      classificationRef: inspection.derivedClassificationRef,
      sourceClassifications: ["internal"],
      resourceSetDigest: digest("resource-set-happy"),
      lineageDigest: digest("lineage-happy"),
      units: 1,
      ceiling: 100,
      terminalReceipt: {
        runRef: `run:${requestId}`,
        finalCounterDigest: digest("final-happy"),
        terminal: true,
        pendingWork: false,
      },
      expiresAt: now + 300_000,
    }, AbortSignal.timeout(5_000));
    expect(reservation.reservationRef).toBeTruthy();

    await client.commit({
      reservation,
      outputRef: blob.outputRef,
      outputDigest: blob.outputDigest,
      releaseFence: "fence:release:happy-disclosure",
    }, AbortSignal.timeout(5_000));

    const authorization = await client.authorize({
      requestId,
      subjectRef: "subject-1",
      outputRef: blob.outputRef,
      outputDigest: blob.outputDigest,
      classificationRef: inspection.derivedClassificationRef,
      disclosureReservationRef: reservation.reservationRef,
    }, AbortSignal.timeout(5_000));
    expect(authorization.releaseFence).toBe("fence:release:happy-disclosure");
    expect(authorization.obligations).toEqual(["audit", "no-store"]);
  });

  it("rejects admissions with missing or malformed RAG profile lineage", async () => {
    const base = {
      kind: "generation",
      request_id: "req-invalid-profile",
      turn_id: "turn-invalid-profile",
      input_digest: digest("input-invalid-profile"),
      rag_profile_version: 1,
      rag_profile_digest: digest("rag-profile-invalid"),
    };
    for (const body of [
      { ...base, rag_profile_version: undefined },
      { ...base, rag_profile_version: -1 },
      { ...base, rag_profile_digest: "sha256:not-a-digest" },
    ]) {
      const response = await fetch(`${server.url}/v1/audit/admissions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-lens-caller-workload": "ai-orchestrator",
          "x-lens-authority-token": WORKLOAD_TOKEN,
        },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }
  });

  it("deny path: output guard denies on empty output", async () => {
    const result = await client.inspect({
      requestId: "req-deny",
      subjectRef: "subject-1",
      output: "",
      outputDigest: digest(""),
      sourceClassifications: [],
    }, AbortSignal.timeout(5_000));
    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error("expected deny");
    expect(result.reason).toMatch(/empty/i);
  });

  it("idempotency: repeating admit with the same input_digest returns the same receipt", async () => {
    const input = {
      kind: "generation" as const,
      requestId: "req-idempotent",
      turnId: "turn-idempotent",
      inputDigest: digest("same-input"),
      ragProfileVersion: 1,
      ragProfileDigest: digest("rag-profile-idempotent"),
    };
    const first = await client.admit(input, AbortSignal.timeout(5_000));
    const second = await client.admit(input, AbortSignal.timeout(5_000));
    expect(second.receiptDigest).toBe(first.receiptDigest);
  });

  it("durability: writes via one AuthorityService/store survive closing and reopening against the same DB file", async () => {
    const dbPath = join(dir, "durable-http.db");
    const first = await startServer(dbPath);
    const firstClient = new AuthorityHttpClient(first.url, WORKLOAD_TOKEN);
    await firstClient.admit({
      kind: "release",
      requestId: "req-durable",
      turnId: "turn-durable",
      inputDigest: digest("durable-input"),
      ragProfileVersion: 1,
      ragProfileDigest: digest("rag-profile-durable"),
    }, AbortSignal.timeout(5_000));
    await first.http.close();
    await first.store.close();

    const second = await startServer(dbPath);
    const admission = await second.store.getAdmission("req-durable", "release");
    expect(admission).toBeDefined();
    await second.http.close();
    await second.store.close();
  });

  it("revoke-then-revalidate: the admin capability revokes a fence and the next revalidate is denied", async () => {
    const requestId = "req-revoke";
    const turnId = "turn-revoke";
    const contextDigest = digest("context-revoke");
    const now = Date.now();

    await client.revalidate({
      requestId,
      turnId,
      subjectRef: "subject-1",
      deviceRef: "device-1",
      sessionRef: "session-1",
      contextDigest,
      manifestExpiresAt: now + 60_000,
      boundary: "generation_start",
      resourceRefs: ["resource-revoke"],
      indexGeneration: "index:1",
    }, AbortSignal.timeout(5_000));

    const revokedCount = await server.service.revokeContextFence(requestId, turnId);
    expect(revokedCount).toBe(1);

    await expect(
      client.revalidate({
        requestId,
        turnId,
        subjectRef: "subject-1",
        deviceRef: "device-1",
        sessionRef: "session-1",
        contextDigest,
        manifestExpiresAt: now + 60_000,
        boundary: "generation_start",
        resourceRefs: ["resource-revoke"],
        indexGeneration: "index:1",
      }, AbortSignal.timeout(5_000)),
    ).rejects.toThrow();
  });
});
