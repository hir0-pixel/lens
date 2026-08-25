import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { DurableConversationHistory } from "../src/durableConversationHistory";

const KEY = randomBytes(32).toString("hex");
let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lens-history-"));
  dbPath = join(dir, "history.sqlite");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("DurableConversationHistory", () => {
  it("rejects construction without a well-formed 32-byte encryption key", () => {
    expect(() => new DurableConversationHistory({ dbPath, encryptionKeyHex: "not-hex" })).toThrow(/64 hex characters/);
    expect(() => new DurableConversationHistory({ dbPath, encryptionKeyHex: "ab".repeat(16) })).toThrow(/64 hex characters/);
  });

  it("survives a process restart: data written before close is readable after reopening the same file", async () => {
    const first = new DurableConversationHistory({ dbPath, encryptionKeyHex: KEY });
    await first.append({ subjectRef: "s1", sessionRef: "sess-1", conversationRef: "sess-1", turn: { role: "user", text: "What is the leave policy?" } });
    await first.append({ subjectRef: "s1", sessionRef: "sess-1", conversationRef: "sess-1", turn: { role: "assistant", text: "20 days a year." } });
    first.close();

    const reopened = new DurableConversationHistory({ dbPath, encryptionKeyHex: KEY });
    const history = await reopened.get({ subjectRef: "s1", sessionRef: "sess-1", conversationRef: "sess-1", limit: 10 });
    reopened.close();

    expect(history).toEqual([
      { role: "user", text: "What is the leave policy?" },
      { role: "assistant", text: "20 days a year." },
    ]);
  });

  it("stores turn text encrypted at rest: the raw database file never contains the plaintext", async () => {
    const store = new DurableConversationHistory({ dbPath, encryptionKeyHex: KEY });
    const secret = "the-confidential-remote-work-stipend-is-1500-dollars";
    await store.append({ subjectRef: "s1", sessionRef: "sess-1", conversationRef: "sess-1", turn: { role: "user", text: secret } });
    await store.close();

    const raw = readFileSync(dbPath);
    expect(raw.includes(Buffer.from(secret, "utf8"))).toBe(false);

    // But subject_ref/session_ref/conversation_ref/role are intentionally cleartext (ownership key columns).
    const inspect = new DatabaseSync(dbPath);
    const row = inspect.prepare("SELECT subject_ref, session_ref, conversation_ref, role FROM conversation_turns LIMIT 1").get() as Record<string, unknown>;
    inspect.close();
    expect(row.subject_ref).toBe("s1");
    expect(row.session_ref).toBe("sess-1");
    expect(row.role).toBe("user");
  });

  it("never returns another subject's or session's history for the same conversation_ref", async () => {
    const store = new DurableConversationHistory({ dbPath, encryptionKeyHex: KEY });
    await store.append({ subjectRef: "subject-a", sessionRef: "shared-session", conversationRef: "shared-session", turn: { role: "user", text: "A's question" } });

    const forB = await store.get({ subjectRef: "subject-b", sessionRef: "shared-session", conversationRef: "shared-session", limit: 10 });
    expect(forB).toEqual([]);

    const forA = await store.get({ subjectRef: "subject-a", sessionRef: "shared-session", conversationRef: "shared-session", limit: 10 });
    expect(forA).toHaveLength(1);
    await store.close();
  });

  it("enforces retention: purgeExpired removes rows past their TTL, deleteConversation removes on demand", async () => {
    let now = 1_000;
    const store = new DurableConversationHistory({ dbPath, encryptionKeyHex: KEY, ttlMs: 500, now: () => now });
    await store.append({ subjectRef: "s1", sessionRef: "sess-1", conversationRef: "sess-1", turn: { role: "user", text: "expiring soon" } });

    now = 1_400; // before expiry
    expect(await store.get({ subjectRef: "s1", sessionRef: "sess-1", conversationRef: "sess-1", limit: 10 })).toHaveLength(1);

    now = 1_600; // past expiry
    const purged = store.purgeExpired(now);
    expect(purged).toBe(1);
    expect(await store.get({ subjectRef: "s1", sessionRef: "sess-1", conversationRef: "sess-1", limit: 10 })).toEqual([]);

    await store.append({ subjectRef: "s2", sessionRef: "sess-2", conversationRef: "sess-2", turn: { role: "user", text: "to be deleted on request" } });
    const deleted = store.deleteConversation({ subjectRef: "s2", sessionRef: "sess-2", conversationRef: "sess-2" });
    expect(deleted).toBe(1);
    expect(await store.get({ subjectRef: "s2", sessionRef: "sess-2", conversationRef: "sess-2", limit: 10 })).toEqual([]);
    await store.close();
  });

  it("bounds history by turn count and byte budget", async () => {
    const store = new DurableConversationHistory({ dbPath, encryptionKeyHex: KEY, maxTurns: 3, maxBytes: 1_000_000 });
    for (let i = 0; i < 6; i++) {
      await store.append({ subjectRef: "s1", sessionRef: "sess-1", conversationRef: "sess-1", turn: { role: i % 2 === 0 ? "user" : "assistant", text: `turn-${i}` } });
    }
    const history = await store.get({ subjectRef: "s1", sessionRef: "sess-1", conversationRef: "sess-1", limit: 10 });
    expect(history).toHaveLength(3);
    expect(history.map((t) => t.text)).toEqual(["turn-3", "turn-4", "turn-5"]);
    await store.close();
  });

});
