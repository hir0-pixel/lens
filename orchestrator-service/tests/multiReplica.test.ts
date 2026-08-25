import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ProductionOrchestratorService,
  type AuditAdmissionPort,
  type DisclosureReservationPort,
  type GenerationContextFencePort,
  type OutputBlobStorePort,
  type OutputGuardPort,
  type ResultAuthorizationPort,
  type RetrievalPort,
  type TurnStatePort,
} from "../src/service";
import type { OrchestratorChatRequest } from "../src/http";
import type { RetrievalRequest, RetrievalResult, RetrievedContext } from "../../libs/rag-contracts";
import { DurableConversationHistory } from "../src/durableConversationHistory";
import { DevRoutePolicyPort, type RoutePolicyPort } from "../src/groundingPolicy";

const NOW = 1_700_000_000_000;
const KEY = randomBytes(32).toString("hex");

function request(overrides: Partial<OrchestratorChatRequest> = {}): OrchestratorChatRequest {
  return {
    requestId: "req-1",
    turnId: "turn-1",
    subjectRef: "subject-1",
    sessionRef: "session-shared",
    conversationRef: "conversation-shared",
    deviceRef: "device-1",
    applicationId: "lens-employee-client",
    purposeRef: "assistant",
    retrievalClass: "enterprise-grounded",
    workspaceRef: "default-workspace",
    capability: "grounded-assistant",
    queryDigest: `sha256:${"a".repeat(64)}`,
    deadlineAt: NOW + 30_000,
    retryBudget: 0,
    bulkhead: "interactive",
    delegatedSessionAssertion: "test-delegated-session-assertion",
    inputText: "",
    ...overrides,
  };
}

function source(overrides: Partial<RetrievedContext> = {}): RetrievedContext {
  return {
    document_version_ref: "leave_policy.docx",
    chunk_ref: "chunk-1",
    content_digest: `sha256:${"b".repeat(64)}`,
    citation_anchor: "Section 1",
    classification_ref: "internal",
    text: "Employees get 20 days of leave per year.",
    ...overrides,
  };
}

function retrievalResult(requestId: string, turnId: string, overrides: Partial<RetrievalResult> = {}): RetrievalResult {
  const retrieved = source();
  return {
    status: "context",
    retrieval_id: `retrieval-${requestId}`,
    request_id: requestId,
    turn_id: turnId,
    visibility_sequence: 1,
    index_generation: "index:1",
    context_digest: `sha256:${"c".repeat(64)}`,
    manifest: {
      digest: `sha256:${"c".repeat(64)}`,
      retrieved_at: NOW,
      source_revision_digest: `sha256:${"e".repeat(64)}`,
      operation_decision_ref: "decision:operation",
      candidate_decision_ref: "decision:candidates",
      policy_revision: 1,
      subject_security_revision: 1,
      resource_security_revision_digest: `sha256:${"f".repeat(64)}`,
      expires_at: NOW + 10_000,
      sources: [retrieved],
    },
    sources: [retrieved],
    ...overrides,
  };
}

class RecordingRetrieval implements RetrievalPort {
  readonly calls: RetrievalRequest[] = [];
  constructor(private readonly resultFor: (req: RetrievalRequest) => RetrievalResult) {}
  async retrieve(req: RetrievalRequest): Promise<RetrievalResult> {
    this.calls.push(req);
    return this.resultFor(req);
  }
}

/** Minimal always-allow release ports — this file is about cross-replica history, not release-pipeline behavior (covered elsewhere). */
function fakeReleasePorts(): {
  generationContextFence: GenerationContextFencePort;
  auditAdmission: AuditAdmissionPort;
  outputGuards: OutputGuardPort;
  outputStore: OutputBlobStorePort;
  turnState: TurnStatePort;
  disclosure: DisclosureReservationPort;
  resultAuthorization: ResultAuthorizationPort;
  routePolicy: RoutePolicyPort;
} {
  return {
    generationContextFence: {
      async revalidate(input) {
        return { fenceRef: `fence:${input.boundary}`, contextDigest: input.contextDigest, expiresAt: input.manifestExpiresAt, checkedAt: NOW };
      },
    },
    auditAdmission: {
      async admit(input) {
        return { receiptDigest: `audit:${input.kind}:${input.requestId}` };
      },
    },
    outputGuards: {
      async inspect(input) {
        return { allowed: true, derivedClassificationRef: "internal", guardReceipt: `guard:${input.requestId}` };
      },
    },
    outputStore: {
      async putBlob(input) {
        return { outputRef: `output:${input.turnId}`, outputDigest: input.outputDigest, commitProof: `commit:${input.outputDigest}` };
      },
      async verifyBlob() {
        return true;
      },
      async repairDanglingOutput() {
        return "repaired";
      },
    },
    turnState: {
      async commitTerminal() {},
      async markFailed() {},
    },
    disclosure: {
      async reserve(input) {
        return { reservationRef: `disclosure:${input.requestId}`, classificationRef: input.classificationRef };
      },
      async commit() {},
    },
    resultAuthorization: {
      async authorize(input) {
        return { releaseFence: `release:${input.outputRef}`, obligations: ["audit", "no-store"] };
      },
    },
    routePolicy: new DevRoutePolicyPort({ groundingRequired: true, defaultProfileSelector: "default" }),
  };
}

/**
 * These tests model two Orchestrator OS processes ("replicas") as two
 * separate `ProductionOrchestratorService` instances that share nothing in
 * memory. Each service owns its own `DurableConversationHistory` object
 * (Node's `node:sqlite` `DatabaseSync` handle) so no JS object — not even the
 * store wrapper — is shared; the only thing the two instances have in common
 * is a filesystem path, exactly like two processes pointed at the same
 * `LENS_CONVERSATION_HISTORY_DB_PATH` volume in production. Per the
 * Orchestrator's own request-scoped design, `contexts`/`requestStates`/
 * `turns`/`outputs` are cleared in `finally { this.releaseRequestState(...) }`
 * at the end of every `handleChat` call, so conversation history is the only
 * state a follow-up turn can depend on across replicas — these tests exist to
 * prove exactly that surface, not to re-prove single-turn behavior already
 * covered elsewhere.
 */
describe("cross-replica contextual follow-up", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "multi-replica-"));
    dbPath = join(dir, "history.sqlite");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("a follow-up handled by replica B correctly rewrites and retrieves using a turn that only ever ran on replica A", async () => {
    const historyOnReplicaA = new DurableConversationHistory({ dbPath, encryptionKeyHex: KEY, now: () => NOW });
    const historyOnReplicaB = new DurableConversationHistory({ dbPath, encryptionKeyHex: KEY, now: () => NOW });
    expect(historyOnReplicaA).not.toBe(historyOnReplicaB);

    const retrievalA = new RecordingRetrieval((req) => retrievalResult(req.request_id, req.turn_id));
    const replicaA = new ProductionOrchestratorService({ devInMemoryAuthorities: true, retrieval: retrievalA, now: () => NOW, conversationHistory: historyOnReplicaA, ...fakeReleasePorts() });

    const firstTurn = await replicaA.handleChat(
      request({ requestId: "req-a1", turnId: "turn-a1", inputText: "What is the leave policy?" }),
      new AbortController().signal,
    );
    expect(firstTurn.status).toBe("COMPLETED");

    // Replica B has never seen this session. It is a fresh instance with its
    // own empty in-memory Maps; the only channel by which it can learn about
    // turn 1 is the shared SQLite file.
    const retrievalB = new RecordingRetrieval((req) => retrievalResult(req.request_id, req.turn_id, {
      sources: [source({ text: "Contractors accrue leave at the same rate as employees." })],
    }));
    const turnRouterOnReplicaB = {
      classify: async (input: { history: readonly { role: string; text: string }[] }) => {
        // A real router would decide this from context; what this test cares
        // about is that `input.history` — sourced from replicaB's OWN history
        // port — is non-empty here, proving it came from the shared file, not
        // from any in-memory state replica A might hold.
        if (input.history.length === 0) return undefined;
        return { route: "SINGLE_RETRIEVAL", standalone_query: "What is the leave policy for contractors?", profile_selector: "default", reason_code: "followup_reference", confidence_bucket: "HIGH" };
      },
    };
    const replicaB = new ProductionOrchestratorService({ devInMemoryAuthorities: true,
      retrieval: retrievalB,
      now: () => NOW,
      conversationHistory: historyOnReplicaB,
      turnRouter: turnRouterOnReplicaB,
      ...fakeReleasePorts(),
    });

    const secondTurn = await replicaB.handleChat(
      request({ requestId: "req-b1", turnId: "turn-b1", inputText: "What about contractors?" }),
      new AbortController().signal,
    );

    expect(secondTurn.status).toBe("COMPLETED");
    expect(retrievalB.calls).toHaveLength(1);
    expect(retrievalB.calls[0]?.query_text).toBe("What is the leave policy for contractors?");
    expect(secondTurn.output).toContain("Question: What is the leave policy for contractors?");
    expect(secondTurn.output).toContain("Contractors accrue leave at the same rate as employees.");

    historyOnReplicaA.close();
    historyOnReplicaB.close();
  });

  it("negative control: the same scenario degrades to a fresh, non-contextual query when replica B is NOT pointed at the shared store (proves the positive test is real, not a tautology)", async () => {
    const historyOnReplicaA = new DurableConversationHistory({ dbPath, encryptionKeyHex: KEY, now: () => NOW });
    const isolatedDbPath = join(dir, "unshared.sqlite");
    const historyIsolatedFromReplicaA = new DurableConversationHistory({ dbPath: isolatedDbPath, encryptionKeyHex: KEY, now: () => NOW });

    const retrievalA = new RecordingRetrieval((req) => retrievalResult(req.request_id, req.turn_id));
    const replicaA = new ProductionOrchestratorService({ devInMemoryAuthorities: true, retrieval: retrievalA, now: () => NOW, conversationHistory: historyOnReplicaA, ...fakeReleasePorts() });
    await replicaA.handleChat(
      request({ requestId: "req-a2", turnId: "turn-a2", inputText: "What is the leave policy?" }),
      new AbortController().signal,
    );

    const retrievalIsolated = new RecordingRetrieval((req) => retrievalResult(req.request_id, req.turn_id));
    const replicaIsolated = new ProductionOrchestratorService({ devInMemoryAuthorities: true,
      retrieval: retrievalIsolated,
      now: () => NOW,
      conversationHistory: historyIsolatedFromReplicaA,
      // No turnRouter: this exercises router.ts's own deterministic fallback,
      // which must never fabricate a rewrite it has no history to support.
      ...fakeReleasePorts(),
    });

    const response = await replicaIsolated.handleChat(
      request({ requestId: "req-b2", turnId: "turn-b2", inputText: "What about contractors?" }),
      new AbortController().signal,
    );

    expect(response.status).toBe("COMPLETED");
    // Not rewritten — retrieved using the raw text, because this replica's
    // history store never received turn 1 (different file, no shared state).
    expect(retrievalIsolated.calls[0]?.query_text).toBe("What about contractors?");

    historyOnReplicaA.close();
    historyIsolatedFromReplicaA.close();
  });
});
