import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import { main } from "../src/main";

const TOKEN = "c".repeat(40);

describe("Agent-run authority HTTP service", () => {
  it("starts on loopback and owns the shared claim store", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-http-"));
    const keys = generateKeyPairSync("ed25519");
    const running = await main({
      PORT: "0",
      HOST: "127.0.0.1",
      AGENT_RUN_WORKLOAD_TOKEN: TOKEN,
      AGENT_RUN_STORAGE_PROFILE: "test",
      AGENT_RUN_DB_PATH: join(dir, "agent.db"),
      AGENT_RUN_SIGNING_KEY: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    });
    await running.close();
  });
});
