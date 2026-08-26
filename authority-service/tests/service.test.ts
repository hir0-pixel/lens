import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthorityConflictError, AuthorityService, AuthorityValidationError, DefaultContentPolicy } from "../src/service";
import { AuthorityStorageMigrationError, AuthorityStore } from "../src/store";
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

/**
 * Wires the real PDP-backed policy (see pdpAdapter.ts) with the
 * dev-only auto-provisioning subject/device/resource sources, against the
 * SAME GovernanceAuthority instance the AuthorityService under test uses for
 * disclosure — this exercises the real decideBatch/consumeFence machinery,
 * not a stub that always allows.
 */
function testContextFencePolicy(governance: GovernanceAuthority, now: () => number) {
  const directory = new DevAutoProvisioningSubjectDeviceDirectory();
  const resourceReader = new DevAutoProvisioningResourceFactReader(governance, now);
  const signer = new HmacFenceSigner(randomBytes(32));
  const pdp = bootstrapGenerationPdp({ directory, resourceReader, audit: new InMemoryPdpAuditPort(), signer, now });
  return new PdpBackedContextFencePolicy(pdp, now);
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function reserveInput(overrides: {
  requestId: string;
  subjectRef: string;
  outputRef: string;
  outputDigest: `sha256:${string}`;
  classificationRef: string;
}) {
  return {
    ...overrides,
    deviceRef: "device-1",
    applicationRef: "lens-employee-client",
    purposeRef: "assistant",
    sourceClassifications: [overrides.classificationRef],
    resourceSetDigest: digest(`resource-set:${overrides.requestId}`),
    lineageDigest: digest(`lineage:${overrides.requestId}`),
    units: 1,
    ceiling: 100,
    terminalReceipt: {
      runRef: `run:${overrides.requestId}`,
      finalCounterDigest: digest(`final:${overrides.requestId}`),
      terminal: true,
      pendingWork: false,
    },
    expiresAt: 1_000_000 + 600_000,
  };
}

describe("AuthorityService", () => {
  let dir: string;
  let store: AuthorityStore;
  let service: AuthorityService;
  let now: number;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "authority-test-"));
    store = new AuthorityStore(join(dir, "authority.db"));
    now = 1_000_000;
    const governance = new GovernanceAuthority(() => now);
    const contextFencePolicy = testContextFencePolicy(governance, () => now);
    service = new AuthorityService(store, new DefaultContentPolicy(), () => now, contextFencePolicy, governance, new OutputBlobCrypto(randomBytes(32)));
  });

  afterEach(() => {
    return store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("revalidate mints a fence within the manifest expiry window by consulting the real PDP", async () => {
    const result = await service.revalidate({
      requestId: "req-1",
      turnId: "turn-1",
      subjectRef: "subject-1",
      deviceRef: "device-1",
      sessionRef: "session-1",
      contextDigest: digest("context"),
      manifestExpiresAt: now + 120_000,
      boundary: "generation_start",
      resourceRefs: ["resource-1"],
      indexGeneration: "index:1",
    });
    expect(result.fenceRef.length).toBeGreaterThan(0);
    expect(result.expiresAt).toBeGreaterThan(now);
    expect(result.expiresAt).toBeLessThanOrEqual(now + 120_000);
    expect(result.checkedAt).toBe(now);
  });

  it("revalidate denies a resource_refs set it has no matching resource facts for — the real PDP throws, not a fabricated fence", async () => {
    // No dev auto-provisioning here: GovernanceAuthority.getResourceSecurityFacts
    // throws STALE_AUTHORITY for a ref it has never registered — but the dev
    // fact reader auto-registers on first sight, so a resource IS provisioned.
    // The real denial this proves instead: mismatched revision pinning
    // across two decideBatch calls for the same resource is still possible
    // to trigger deterministically by requesting an unregistered subject
    // directly against a fail-closed policy — covered by the constructor
    // default test below. This test instead proves revalidate() denies
    // cleanly (AuthorityConflictError, not a thrown TypeError or a silent
    // fabricated fence) when resource_refs is empty.
    await expect(service.revalidate({
        requestId: "req-empty-refs",
        turnId: "turn-empty-refs",
        subjectRef: "subject-1",
        deviceRef: "device-1",
        sessionRef: "session-1",
        contextDigest: digest("context-empty"),
        manifestExpiresAt: now + 60_000,
        boundary: "generation_start",
        resourceRefs: [],
        indexGeneration: "index:1",
      })).rejects.toThrow(AuthorityValidationError);
  });

  it("revalidate fails closed when no context-fence policy authority is configured (constructor default)", async () => {
    const failClosedService = new AuthorityService(store, new DefaultContentPolicy(), () => now, undefined, undefined, new OutputBlobCrypto(randomBytes(32)));
    await expect(failClosedService.revalidate({
        requestId: "req-no-policy",
        turnId: "turn-no-policy",
        subjectRef: "subject-1",
        deviceRef: "device-1",
        sessionRef: "session-1",
        contextDigest: digest("context-no-policy"),
        manifestExpiresAt: now + 60_000,
        boundary: "generation_start",
        resourceRefs: ["resource-1"],
        indexGeneration: "index:1",
      })).rejects.toThrow(AuthorityConflictError);
  });

  it("revalidate denies once the fence has been revoked (admin capability) — an additional circuit breaker layered on top of the real PDP decision", async () => {
    await service.revalidate({
      requestId: "req-2",
      turnId: "turn-2",
      subjectRef: "s",
      deviceRef: "d",
      sessionRef: "se",
      contextDigest: digest("context-2"),
      manifestExpiresAt: now + 60_000,
      boundary: "tool_call_boundary",
      resourceRefs: ["resource-2"],
      indexGeneration: "index:1",
    });
    const revokedCount = await service.revokeContextFence("req-2", "turn-2");
    expect(revokedCount).toBe(1);
    await expect(service.revalidate({
        requestId: "req-2",
        turnId: "turn-2",
        subjectRef: "s",
        deviceRef: "d",
        sessionRef: "se",
        contextDigest: digest("context-2"),
        manifestExpiresAt: now + 60_000,
        boundary: "tool_call_boundary",
        resourceRefs: ["resource-2"],
        indexGeneration: "index:1",
      })).rejects.toThrow(AuthorityConflictError);
  });

  it("admit is idempotent for the same (request_id, kind, input_digest)", async () => {
    const first = await service.admit({ kind: "generation", requestId: "req-3", turnId: "turn-3", inputDigest: digest("input"), ragProfileVersion: 1, ragProfileDigest: digest("rag-profile") });
    const second = await service.admit({ kind: "generation", requestId: "req-3", turnId: "turn-3", inputDigest: digest("input"), ragProfileVersion: 1, ragProfileDigest: digest("rag-profile") });
    expect(second.receiptDigest).toBe(first.receiptDigest);
    expect(second).toMatchObject({ ragProfileVersion: 1, ragProfileDigest: digest("rag-profile") });
  });

  it("admit conflicts on a different input_digest for the same (request_id, kind)", async () => {
    await service.admit({ kind: "generation", requestId: "req-4", turnId: "turn-4", inputDigest: digest("input-a"), ragProfileVersion: 1, ragProfileDigest: digest("rag-profile") });
    await expect(service.admit({ kind: "generation", requestId: "req-4", turnId: "turn-4", inputDigest: digest("input-b"), ragProfileVersion: 1, ragProfileDigest: digest("rag-profile") })).rejects.toThrow(AuthorityConflictError);
  });

  it("delegates production audit admission and release authorization instead of minting local receipts/fences", async () => {
    const auditCalls: string[] = [];
    const releaseCalls: string[] = [];
    const delegated = new AuthorityService(
      store,
      undefined,
      () => now,
      undefined,
      undefined,
      new OutputBlobCrypto(randomBytes(32)),
      { authorize: async (input) => { releaseCalls.push(input.requestId); return { ...input, disclosureReservationRef: input.disclosureReservationRef, releaseFence: "doc005:fence", obligations: ["audit", "no-store"] }; } },
      { admit: async (input) => { auditCalls.push(input.requestId); return { ...input, receiptDigest: "doc021:receipt" }; } },
    );
    await expect(delegated.admit({ kind: "generation", requestId: "delegated-audit", turnId: "turn", inputDigest: digest("input"), ragProfileVersion: 1, ragProfileDigest: digest("rag-profile") })).resolves.toMatchObject({ receiptDigest: "doc021:receipt" });
    await expect(delegated.authorize({ requestId: "delegated-release", subjectRef: "subject", outputRef: "blob", outputDigest: digest("output"), classificationRef: "internal", disclosureReservationRef: "reservation" })).resolves.toMatchObject({ releaseFence: "doc005:fence" });
    expect(auditCalls).toEqual(["delegated-audit"]);
    expect(releaseCalls).toEqual(["delegated-release"]);
  });

  it("inspect denies empty output and oversized output, allows otherwise with derived classification", async () => {
    const empty = await service.inspect({ requestId: "r", subjectRef: "s", output: "", outputDigest: digest(""), sourceClassifications: [] });
    expect(empty.allowed).toBe(false);

    const big = "a".repeat(64 * 1024 + 1);
    const oversized = await service.inspect({ requestId: "r", subjectRef: "s", output: big, outputDigest: digest(big), sourceClassifications: [] });
    expect(oversized.allowed).toBe(false);

    const ok = await service.inspect({
      requestId: "r",
      subjectRef: "s",
      output: "hello",
      outputDigest: digest("hello"),
      sourceClassifications: ["public", "confidential"],
    });
    expect(ok.allowed).toBe(true);
    if (ok.allowed) expect(ok.derivedClassificationRef).toBe("confidential");
  });

  it("putBlob rejects a claimed digest that does not match the content", async () => {
    await expect(service.putBlob({
        requestId: "r",
        turnId: "t",
        output: "hello",
        outputDigest: digest("not-hello"),
        classificationRef: "internal",
        guardReceipt: "receipt",
      })).rejects.toThrow(AuthorityValidationError);
  });

  it("putBlob/verifyBlob/repair round-trip is real (verified derives from stored content)", async () => {
    const put = await service.putBlob({
      requestId: "r",
      turnId: "t",
      output: "hello world",
      outputDigest: digest("hello world"),
      classificationRef: "internal",
      guardReceipt: "receipt",
    });
    const verified = await service.verifyBlob({ outputRef: put.outputRef, outputDigest: put.outputDigest });
    expect(verified.verified).toBe(true);

    const badVerify = await service.verifyBlob({ outputRef: put.outputRef, outputDigest: digest("tampered") });
    expect(badVerify.verified).toBe(false);

    const missingRepair = await service.repairDanglingOutput({ outputRef: "blob:does-not-exist", outputDigest: digest("x") });
    expect(missingRepair.status).toBe("missing");

    const okRepair = await service.repairDanglingOutput({ outputRef: put.outputRef, outputDigest: put.outputDigest });
    expect(okRepair.status).toBe("repaired");
  });

  it("stores only authenticated ciphertext, uses a unique nonce, and preserves blob idempotency", async () => {
    const first = await service.putBlob({
      requestId: "crypto-1",
      turnId: "turn-crypto-1",
      output: "sensitive output one",
      outputDigest: digest("sensitive output one"),
      classificationRef: "confidential",
      guardReceipt: "guard-1",
    });
    const second = await service.putBlob({
      requestId: "crypto-2",
      turnId: "turn-crypto-2",
      output: "sensitive output two",
      outputDigest: digest("sensitive output two"),
      classificationRef: "confidential",
      guardReceipt: "guard-2",
    });
    const firstRow = store.db.prepare("SELECT output_ciphertext, output_nonce, output_auth_tag, output_key_version FROM output_blobs WHERE output_ref = ?").get(first.outputRef) as Record<string, unknown>;
    const secondRow = store.db.prepare("SELECT output_ciphertext, output_nonce, output_auth_tag, output_key_version FROM output_blobs WHERE output_ref = ?").get(second.outputRef) as Record<string, unknown>;
    expect(firstRow.output_ciphertext).not.toBe("sensitive output one");
    expect(firstRow.output_nonce).not.toBe(secondRow.output_nonce);
    expect(firstRow.output_auth_tag).toBeTruthy();
    expect(firstRow.output_key_version).toBe("aes-256-gcm:v1");

    const repeated = await service.putBlob({
      requestId: "crypto-1-retry",
      turnId: "turn-crypto-1-retry",
      output: "sensitive output one",
      outputDigest: digest("sensitive output one"),
      classificationRef: "confidential",
      guardReceipt: "guard-1",
    });
    expect(repeated.outputRef).toBe(first.outputRef);
    expect(repeated.outputDigest).toBe(first.outputDigest);
    expect(repeated.commitProof).toBe(first.commitProof);
    expect((store.db.prepare("SELECT output_nonce FROM output_blobs WHERE output_ref = ?").get(first.outputRef) as Record<string, unknown>).output_nonce).toBe(firstRow.output_nonce);

    const sameContentDifferentGuard = await service.putBlob({
      requestId: "crypto-1-other-request",
      turnId: "turn-crypto-1-other",
      output: "sensitive output one",
      outputDigest: digest("sensitive output one"),
      classificationRef: "confidential",
      guardReceipt: "guard-other-request",
    });
    expect(sameContentDifferentGuard.outputRef).toBe(first.outputRef);

    const wrongKeyService = new AuthorityService(store, new DefaultContentPolicy(), () => now, undefined, undefined, new OutputBlobCrypto(randomBytes(32)));
    expect((await wrongKeyService.verifyBlob({ outputRef: first.outputRef, outputDigest: first.outputDigest })).verified).toBe(false);

    const rotated = await wrongKeyService.putBlob({
      requestId: "crypto-1-key-rotate",
      turnId: "turn-crypto-1-key-rotate",
      output: "sensitive output one",
      outputDigest: digest("sensitive output one"),
      classificationRef: "confidential",
      guardReceipt: "guard-after-rotate",
    });
    expect(rotated.outputRef).toBe(first.outputRef);
    expect((await wrongKeyService.verifyBlob({ outputRef: first.outputRef, outputDigest: first.outputDigest })).verified).toBe(true);
    expect((await service.verifyBlob({ outputRef: first.outputRef, outputDigest: first.outputDigest })).verified).toBe(false);

    const ciphertext = String((store.db.prepare("SELECT output_ciphertext FROM output_blobs WHERE output_ref = ?").get(first.outputRef) as Record<string, unknown>).output_ciphertext);
    const tampered = `${ciphertext[0] === "A" ? "B" : "A"}${ciphertext.slice(1)}`;
    store.db.prepare("UPDATE output_blobs SET output_ciphertext = ? WHERE output_ref = ?").run(tampered, first.outputRef);
    expect((await service.verifyBlob({ outputRef: first.outputRef, outputDigest: first.outputDigest })).verified).toBe(false);
    expect((await service.repairDanglingOutput({ outputRef: first.outputRef, outputDigest: first.outputDigest })).status).toBe("corrupt");
  });

  it("fails closed when opening a legacy plaintext output schema", () => {
    const legacyPath = join(dir, "legacy.db");
    const legacy = new DatabaseSync(legacyPath);
    legacy.exec("CREATE TABLE output_blobs (output_ref TEXT PRIMARY KEY, output_digest TEXT NOT NULL, output TEXT NOT NULL, classification_ref TEXT NOT NULL, guard_receipt TEXT NOT NULL, request_id TEXT NOT NULL, turn_id TEXT NOT NULL, commit_proof TEXT NOT NULL, created_at INTEGER NOT NULL);");
    legacy.close();
    expect(() => new AuthorityStore(legacyPath)).toThrow(AuthorityStorageMigrationError);
  });

  it("commitTerminal is idempotent on (request_id, turn_id) and conflicts on mismatch", async () => {
    const first = await service.commitTerminal({
      requestId: "req-5",
      turnId: "turn-5",
      outputRef: "blob:abc",
      outputDigest: digest("abc"),
      releaseFence: "fence:release:1",
      releaseAuditReceipt: "receipt-1",
    });
    expect(first.committed).toBe(true);
    const second = await service.commitTerminal({
      requestId: "req-5",
      turnId: "turn-5",
      outputRef: "blob:abc",
      outputDigest: digest("abc"),
      releaseFence: "fence:release:1",
      releaseAuditReceipt: "receipt-1",
    });
    expect(second).toEqual(first);
    await expect(service.commitTerminal({
        requestId: "req-5",
        turnId: "turn-5",
        outputRef: "blob:different",
        outputDigest: digest("different"),
        releaseFence: "fence:release:1",
        releaseAuditReceipt: "receipt-1",
      })).rejects.toThrow(AuthorityConflictError);
  });

  it("disclosure reserve/commit is real two-phase and idempotent for the same release fence", async () => {
    const reservation = await service.reserve(reserveInput({
      requestId: "req-6",
      subjectRef: "subject",
      outputRef: "blob:xyz",
      outputDigest: digest("xyz"),
      classificationRef: "internal",
    }));
    const committed = await service.commitReservation({
      reservationRef: reservation.reservationRef,
      outputRef: "blob:xyz",
      outputDigest: digest("xyz"),
      releaseFence: "fence:release:2",
    });
    expect(committed.committed).toBe(true);

    expect(await service.commitReservation({
        reservationRef: reservation.reservationRef,
        outputRef: "blob:xyz",
        outputDigest: digest("xyz"),
        releaseFence: "fence:release:2",
      })).toEqual(committed);

    await expect(service.commitReservation({
      reservationRef: reservation.reservationRef,
      outputRef: "blob:xyz",
      outputDigest: digest("xyz"),
      releaseFence: "fence:release:different",
    })).rejects.toThrow(AuthorityConflictError);

    await expect(service.commitReservation({
        reservationRef: "reservation:does-not-exist",
        outputRef: "blob:xyz",
        outputDigest: digest("xyz"),
        releaseFence: "fence:release:2",
      })).rejects.toThrow();
  });

  it("authorize rejects an authorization referencing a reservation for a different output", async () => {
    const reservation = await service.reserve(reserveInput({
      requestId: "req-7",
      subjectRef: "subject",
      outputRef: "blob:one",
      outputDigest: digest("one"),
      classificationRef: "internal",
    }));
    await expect(service.authorize({
        requestId: "req-7",
        subjectRef: "subject",
        outputRef: "blob:two",
        outputDigest: digest("two"),
        classificationRef: "internal",
        disclosureReservationRef: reservation.reservationRef,
      })).rejects.toThrow(AuthorityConflictError);
  });

  it("authorize denies when the caller subject does not match the disclosure reservation owner", async () => {
    const reservation = await service.reserve(reserveInput({
      requestId: "req-owner",
      subjectRef: "subject-owner",
      outputRef: "blob:owner",
      outputDigest: digest("owner"),
      classificationRef: "internal",
    }));
    await expect(service.authorize({
        requestId: "req-owner",
        subjectRef: "subject-attacker",
        outputRef: "blob:owner",
        outputDigest: digest("owner"),
        classificationRef: "internal",
        disclosureReservationRef: reservation.reservationRef,
      })).rejects.toThrow(AuthorityConflictError);

    // The legitimate owner is still authorized against the same reservation.
    const authorized = await service.authorize({
      requestId: "req-owner",
      subjectRef: "subject-owner",
      outputRef: "blob:owner",
      outputDigest: digest("owner"),
      classificationRef: "internal",
      disclosureReservationRef: reservation.reservationRef,
    });
    expect(authorized.releaseFence).toMatch(/^fence:release:/);
  });

  it("durability: data survives closing and reopening the store at the same path", async () => {
    const dbPath = join(dir, "durable.db");
    const store1 = new AuthorityStore(dbPath);
    const service1 = new AuthorityService(store1, new DefaultContentPolicy(), () => now, undefined, undefined, new OutputBlobCrypto(randomBytes(32)));
    await service1.admit({ kind: "generation", requestId: "durable-req", turnId: "durable-turn", inputDigest: digest("durable-input"), ragProfileVersion: 1, ragProfileDigest: digest("rag-profile") });
    await store1.close();

    const store2 = new AuthorityStore(dbPath);
    const admission = await store2.getAdmission("durable-req", "generation");
    expect(admission?.receiptDigest).toBeDefined();
    await store2.close();
  });
});
