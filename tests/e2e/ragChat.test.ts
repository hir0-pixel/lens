import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRagChatHarness, type RagChatHarness } from "./ragChatHarness";

describe("real employee RAG chat composition", () => {
  let harness: RagChatHarness;

  beforeAll(async () => {
    harness = await createRagChatHarness();
  });

  afterAll(async () => {
    await harness?.close();
  });

  it("ingests, publishes, retrieves, and cites the distinctive policy source", async () => {
    const source = "The cobalt lantern policy requires a two-person review before production release.";
    await harness.ingest({ sourceId: "policy", documentRef: "policy-doc", versionRef: "policy-v1", text: source });
    const response = await harness.ask("What does the cobalt lantern policy require before production release?");
    expect(response.citations.some((citation) => citation.source.includes("policy"))).toBe(true);
    expect(response.output).toContain("two-person review");
    expect(harness.retrievalRequestCount()).toBeGreaterThan(0);
  });

  it.each(["hello", "okay"])("does not invoke retrieval for %s", async (query) => {
    const before = harness.retrievalRequestCount();
    await harness.ask(query);
    expect(harness.retrievalRequestCount()).toBe(before);
  });

  it("does not leak content when the user is unauthorized", async () => {
    harness.setSubject("unauthorized");
    try {
      const response = await harness.askRaw("What does the cobalt lantern policy require?");
      expect(response.status).toBe(403);
      expect(JSON.stringify(response.body)).not.toContain("cobalt lantern");
      expect(JSON.stringify(response.body)).not.toMatch(/citation|content|chunk/i);
    } finally {
      harness.setSubject("employee-1");
    }
  });

  it("withdraws the old generation before serving replacement content", async () => {
    await harness.ingest({ sourceId: "policy", documentRef: "policy-doc", versionRef: "policy-v2", text: "The amber compass policy requires quarterly review." });
    await harness.withdraw("policy-v1");
    const response = await harness.ask("What does the cobalt lantern policy require?");
    expect(JSON.stringify(response)).not.toContain("two-person review");
    expect(JSON.stringify(response)).toContain("quarterly review");
  });

  it("fails closed for a mismatched profile", async () => {
    const response = await harness.askWithProfile("What does the amber compass policy require?", { profileVersion: 999 });
    expect(response.status).not.toBe(200);
    expect(JSON.stringify(response.body)).not.toContain("amber compass");
  });

  it("retrieves semantic paraphrases with no lexical overlap", async () => {
    const source = "The quarterly budget review must be approved by two finance directors before disbursement.";
    await harness.ingest({ sourceId: "finance", documentRef: "finance-doc", versionRef: "finance-v1", text: source });
    const response = await harness.askWithMode("What group has to sign off on spending plans before money goes out each three months?", "semantic");
    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).toContain("finance");
  });

  it("no-match answers do not reveal that ingested documents exist", async () => {
    const response = await harness.askWithMode("banana smoothie recipe", "lexical");
    const body = JSON.stringify(response.body);
    expect(body).not.toContain("cobalt lantern");
    expect(body).not.toContain("orbital archive");
    expect(body).not.toContain("policy-doc");
    expect(body).not.toMatch(/citation|chunkRef|document_version/i);
  });

  it("hybrid retrieval returns literal and vector-grounded content", async () => {
    const source = "The orbital archive requires a dual-key review before launch scheduling.";
    await harness.ingest({ sourceId: "archive", documentRef: "archive-doc", versionRef: "archive-v1", text: source });
    const response = await harness.askWithMode("What does the orbital archive require before launch scheduling?", "hybrid");
    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).toContain("dual-key review");
  });

  it("fails closed without the vector backend", async () => {
    harness.disableVectorBackend();
    const response = await harness.askWithMode("What group has to sign off on spending plans before money goes out each three months?", "semantic");
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(JSON.stringify(response.body)).not.toContain("finance directors");
    harness.enableVectorBackend();
  });

  it("does not return withdrawn content through lexical or semantic lanes", async () => {
    await harness.ingest({ sourceId: "withdrawn", documentRef: "withdrawn-doc", versionRef: "withdrawn-v1", text: "The withdrawn heliotrope protocol requires a sealed review." });
    await harness.withdraw("withdrawn-v1");
    const lexical = await harness.askWithMode("What does the heliotrope protocol require?", "lexical");
    const semantic = await harness.askWithMode("What process does the retired flower protocol require?", "semantic");
    expect(JSON.stringify(lexical.body)).not.toContain("sealed review");
    expect(JSON.stringify(semantic.body)).not.toContain("sealed review");
  });

  it("does not leak semantic retrieval to unauthorized users", async () => {
    await harness.ingest({ sourceId: "restricted", documentRef: "restricted-doc", versionRef: "restricted-v1", text: "The restricted marigold ledger contains a private checksum." });
    harness.setSubject("unauthorized");
    try {
      const response = await harness.askWithMode("What does the private flower ledger contain?", "semantic");
      expect(response.status).toBe(403);
      expect(JSON.stringify(response.body)).not.toContain("private checksum");
      expect(JSON.stringify(response.body)).not.toMatch(/citation|content|chunk/i);
    } finally {
      harness.setSubject("employee-1");
    }
  });

  it("fails closed when a hard dependency is unavailable", async () => {
    await harness.stopRetrieval();
    const response = await harness.askRaw("What does the amber compass policy require?");
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(JSON.stringify(response.body)).not.toContain("amber compass");
  });

  it("does not expose provider catalogs or keys", async () => {
    const response = await harness.askRaw("hello");
    const body = JSON.stringify(response.body);
    expect(body).not.toMatch(/api[_-]?key|provider|catalog/i);
  });
});
