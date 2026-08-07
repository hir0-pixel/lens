import { describe, expect, it } from "vitest";
import { logger, maskSecret } from "@/shared/diagnostics/logger";

describe("logger", () => {
  it("redacts api-key-like strings in messages", () => {
    logger.clear();
    logger.info("key sk-abcdefghijklmnopqrstuv");
    const last = logger.getEntries().at(-1);
    expect(last?.message).not.toContain("sk-abcdefghijklmnopqrstuv");
    expect(last?.message).toMatch(/sk-a|…|\*\*\*/);
  });

  it("redacts context secrets", () => {
    logger.clear();
    logger.error("fail", { apiKey: "sk-supersecretvalue" });
    const last = logger.getEntries().at(-1);
    expect(String(last?.context?.apiKey)).not.toBe("sk-supersecretvalue");
  });

  it("exports maskSecret", () => {
    expect(maskSecret("abcdefghij")).toContain("…");
  });
});
