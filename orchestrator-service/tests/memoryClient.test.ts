import { generateKeyPairSync, createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryServiceHttpClient } from "../src/memoryClient";
import { DelegatedSessionAssertionIssuer } from "../../services/security/delegatedSessionAssertion";

const keys = generateKeyPairSync("ed25519");
const assertion = new DelegatedSessionAssertionIssuer(keys.privateKey, { now: () => 1_700_000_000_000 }).issue({
  issuer: "bff", audience: "memory", requestId: "req-1", subjectRef: "subject-1", sessionRef: "session-1", deviceRef: "device-1", conversationRef: "conversation-1",
  queryDigest: `sha256:${createHash("sha256").update("hello").digest("hex")}`,
  workspaceRef: "default-workspace", requestClass: "enterprise-grounded", purposeRef: "assistant",
});

describe("MemoryServiceHttpClient authorization forwarding", () => {
  it("forwards the distinct memory assertion and current session/device binding", async () => {
    const captured: { headers: HeadersInit; body: Record<string, unknown> }[] = [];
    const fetcher = (async (_url: URL, init: RequestInit) => {
      captured.push({ headers: init.headers ?? {}, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      const body = captured.at(-1)?.body ?? {};
      if (String(_url).includes("turns:begin")) return new Response(JSON.stringify({ subject_ref: body.subject_ref, conversation_ref: body.conversation_ref, turn_id: "turn-1", turn_sequence: 1, input_digest: body.input_digest }), { status: 200 });
      if (String(_url).includes("finalize")) return new Response(JSON.stringify({ subject_ref: body.subject_ref, conversation_ref: body.conversation_ref, turn_id: body.turn_id, output_digest: body.output_digest, committed: true }), { status: 200 });
      return new Response(JSON.stringify({ subject_ref: "subject-1", conversation_ref: "conversation-1", turns: [] }), { status: 200 });
    }) as typeof fetch;
    const client = new MemoryServiceHttpClient("http://127.0.0.1:8788/", "m".repeat(40), 5_000, fetcher);
    await client.get({ requestId: "req-1", subjectRef: "subject-1", sessionRef: "session-1", deviceRef: "device-1", conversationRef: "conversation-1", queryDigest: `sha256:${createHash("sha256").update("hello").digest("hex")}`, limit: 8, memorySessionAssertion: assertion }, new AbortController().signal);
    await client.beginTurn({ requestId: "req-1", subjectRef: "subject-1", sessionRef: "session-1", deviceRef: "device-1", conversationRef: "conversation-1", turnId: "turn-1", inputDigest: `sha256:${"b".repeat(64)}`, inputText: "hello", memorySessionAssertion: assertion }, new AbortController().signal);
    await client.finalizeTurn({
      requestId: "req-1", subjectRef: "subject-1", sessionRef: "session-1", deviceRef: "device-1", conversationRef: "conversation-1", turnId: "turn-1", inputDigest: `sha256:${"b".repeat(64)}`, output: "done", outputDigest: `sha256:${"c".repeat(64)}`,
      terminalEvidence: {
        releaseFence: "release-fence", releaseAuditReceipt: "release-audit-receipt", outputCommitProof: "commit-proof",
        attemptedRoute: "SINGLE_RETRIEVAL", attemptedReasonCode: "knowledge_lookup", attemptedConfidenceBucket: "HIGH",
        effectiveRoute: "SINGLE_RETRIEVAL", groundingRequired: true,
        routePolicyRevision: 1, routePolicyDigest: `sha256:${"d".repeat(64)}`, allowedProfileSetDigest: `sha256:${"e".repeat(64)}`,
        enforcementOverride: false,
      },
      memorySessionAssertion: assertion,
    }, new AbortController().signal);
    expect(captured).toHaveLength(3);
    for (const call of captured) {
      expect(call.body).toMatchObject({ subject_ref: "subject-1", session_ref: "session-1", device_ref: "device-1", conversation_ref: "conversation-1", memory_session_assertion: assertion });
      expect(call.headers).toMatchObject({ "x-lens-memory-assertion": assertion, "x-lens-memory-token": "m".repeat(40) });
    }
    expect(captured[0]?.body).toMatchObject({ request_id: "req-1", query_digest: expect.stringMatching(/^sha256:/) });
    expect(captured[1]?.body).toMatchObject({ request_id: "req-1", input_digest: `sha256:${"b".repeat(64)}` });
    expect(captured[2]?.body).toMatchObject({ request_id: "req-1", turn_id: "turn-1", query_digest: `sha256:${"b".repeat(64)}`, output_digest: `sha256:${"c".repeat(64)}` });
  });

  it("fails closed when the request-bound memory assertion is absent", async () => {
    const client = new MemoryServiceHttpClient("http://127.0.0.1:8788/", "m".repeat(40), 5_000, (async () => new Response("{}")) as typeof fetch);
    await expect(client.get({ requestId: "req-1", subjectRef: "subject-1", sessionRef: "session-1", deviceRef: "device-1", conversationRef: "conversation-1", queryDigest: `sha256:${"a".repeat(64)}`, limit: 8 }, new AbortController().signal)).rejects.toThrow("MEMORY_ASSERTION_REQUIRED");
  });
});
