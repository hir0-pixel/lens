import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONTRACT_NAME,
  CONTRACT_SOURCE_DIGEST,
  CONTRACT_VERSION,
  ERROR_CODES,
} from "../../libs/generated-clients";

const root = ".";

describe("M00 contract registry", () => {
  it("publishes the generated SDK from the registered contract version", async () => {
    const registry = JSON.parse(
      await readFile(path.join(root, "contracts/contract-registry.json"), "utf8"),
    );

    expect(CONTRACT_NAME).toBe(registry.contract);
    expect(CONTRACT_VERSION).toBe(registry.version);
    expect(CONTRACT_SOURCE_DIGEST).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("keeps the complete safe error registry stable", () => {
    expect(ERROR_CODES).toEqual(expect.arrayContaining([
      "INVALID_ARGUMENT",
      "CONFLICT",
      "DEADLINE_EXCEEDED",
      "CANCELLED",
      "INTERNAL",
    ]));
  });

  it("declares additive-only compatibility", async () => {
    const compatibility = JSON.parse(
      await readFile(path.join(root, "contracts/compatibility/v1.json"), "utf8"),
    );

    expect(compatibility.evolution).toBe("additive-only");
    expect(compatibility.current).toBe(CONTRACT_VERSION);
  });
});
