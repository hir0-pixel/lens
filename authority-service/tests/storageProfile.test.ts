import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAuthorityStorage, AuthorityStorageConfigurationError } from "../src/store";
import { main, type AuthorityServiceEnv } from "../src/main";
import { OutputBlobConfigurationError, OutputBlobCrypto } from "../src/outputCrypto";

describe("Authority storage profiles", () => {
  const paths: string[] = [];

  afterEach(() => {
    for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true });
  });

  it("rejects SQLite when the production profile is requested", () => {
    const dir = mkdtempSync(join(tmpdir(), "authority-profile-prod-"));
    paths.push(dir);
    expect(() => createAuthorityStorage({ profile: "production", sqlitePath: join(dir, "authority.db") })).toThrow(AuthorityStorageConfigurationError);
  });

  it.each(["development", "test"] as const)("opens the %s profile with the explicitly development-only SQLite adapter", async (profile) => {
    const dir = mkdtempSync(join(tmpdir(), `authority-profile-${profile}-`));
    paths.push(dir);
    const store = createAuthorityStorage({ profile, sqlitePath: join(dir, "authority.db") });
    expect(store.storageProfile).toBe("development");
    expect(store.replicated).toBe(false);
    await store.close();
  });

  it.each(["development", "test"] as const)("starts and closes the %s Authority profile", async (profile) => {
    const dir = mkdtempSync(join(tmpdir(), `authority-main-${profile}-`));
    paths.push(dir);
    const env: AuthorityServiceEnv = {
      PORT: "0",
      HOST: "127.0.0.1",
      AUTHORITY_WORKLOAD_TOKEN: "a".repeat(40),
      AUTHORITY_DB_PATH: join(dir, "authority.db"),
      AUTHORITY_STORAGE_PROFILE: profile,
      AUTHORITY_OUTPUT_KEY_HEX: "22".repeat(32),
      AUTHORITY_ALLOW_DEV_FACTS: "true",
      AUTHORITY_DEV_PDP_SIGNING_KEY: "33".repeat(32),
      MODEL_USE_SIGNING_KEY: generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    };
    const running = await main(env);
    await running.close();
  });

  it("rejects a production startup without an injected replicated adapter", async () => {
    const env: AuthorityServiceEnv = {
      PORT: "8790",
      HOST: "127.0.0.1",
      AUTHORITY_WORKLOAD_TOKEN: "a".repeat(40),
      AUTHORITY_DB_PATH: join(tmpdir(), "should-not-open.db"),
      AUTHORITY_STORAGE_PROFILE: "production",
      AUTHORITY_OUTPUT_KEY_HEX: "44".repeat(32),
    };
    await expect(main(env)).rejects.toThrow(/Doc 005 release authorization.*Doc 021 audit admission/);
  });

  it("rejects missing or incorrectly sized output encryption keys", () => {
    expect(() => OutputBlobCrypto.fromHex(undefined)).toThrow(OutputBlobConfigurationError);
    expect(() => OutputBlobCrypto.fromHex("00".repeat(31))).toThrow(OutputBlobConfigurationError);
    expect(() => OutputBlobCrypto.fromHex("zz".repeat(32))).toThrow(OutputBlobConfigurationError);
  });
});
