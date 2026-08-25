import { describe, expect, it } from "vitest";
import { loadConversationHistory, type OrchestratorServiceEnv } from "../src/main";
import { MemoryServiceHttpClient } from "../src/memoryClient";

const baseEnv = (overrides: Partial<OrchestratorServiceEnv> = {}): OrchestratorServiceEnv => ({
  ORCHESTRATOR_WORKLOAD_TOKEN: "w".repeat(40), RETRIEVAL_URL: "https://retrieval.internal/", RETRIEVAL_WORKLOAD_TOKEN: "r".repeat(40),
  MODEL_RUNTIME_URL: "https://model.internal/", MODEL_RUNTIME_WORKLOAD_TOKEN: "m".repeat(40), MODEL_ARTIFACT_DIGEST: `sha256:${"a".repeat(64)}`,
  AUTHORITY_URL: "https://authority.internal/", AUTHORITY_WORKLOAD_TOKEN: "h".repeat(40), CONVERSATION_HISTORY_PROFILE: "test", ...overrides,
});

describe("conversation history storage profiles", () => {
  it("rejects SQLite and in-memory history in production", () => {
    expect(() => loadConversationHistory(baseEnv({ CONVERSATION_HISTORY_PROFILE: "production", CONVERSATION_HISTORY_DB_PATH: "history.sqlite", HISTORY_ENCRYPTION_KEY: "a".repeat(64) }))).toThrow(/development\/test-only/);
    expect(() => loadConversationHistory(baseEnv({ CONVERSATION_HISTORY_PROFILE: "production", ALLOW_IN_MEMORY_HISTORY: "true" }))).toThrow(/replicated ConversationHistoryPort/);
  });

  it("allows explicit test storage and constructs the production Memory adapter from configuration", () => {
    expect(loadConversationHistory(baseEnv({ ALLOW_IN_MEMORY_HISTORY: "true" })).history).toBeDefined();
    const history = loadConversationHistory(baseEnv({
      CONVERSATION_HISTORY_PROFILE: "production",
      MEMORY_URL: "https://memory.internal/",
      MEMORY_WORKLOAD_TOKEN: "m".repeat(40),
    })).history;
    expect(history).toBeInstanceOf(MemoryServiceHttpClient);
  });
});
