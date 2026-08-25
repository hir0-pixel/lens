import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../src/main";

const TOKEN = "c".repeat(40);

describe("Cost authority HTTP service", () => {
  it("starts on loopback and refuses a non-internal postgres URL in production", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cost-http-"));
    const keys = generateKeyPairSync("ed25519");
    const pem = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const running = await main({
      PORT: "0",
      HOST: "127.0.0.1",
      COST_WORKLOAD_TOKEN: TOKEN,
      COST_STORAGE_PROFILE: "test",
      COST_DB_PATH: join(dir, "cost.db"),
      COST_SIGNING_KEY: pem,
    });
    await running.close();
    await expect(main({
      PORT: "0",
      HOST: "127.0.0.1",
      COST_WORKLOAD_TOKEN: TOKEN,
      COST_STORAGE_PROFILE: "production",
      COST_DATABASE_URL: "postgres://user@example.com/db",
      COST_SIGNING_KEY: pem,
    })).rejects.toThrow(/internal/);
  });
});
