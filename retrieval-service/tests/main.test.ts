import { afterEach, describe, expect, it } from "vitest";
import { createRetrievalDeployment, type RetrievalDeployment } from "../../services/retrieval/ProductionRetrievalWiring";
import { main, type RetrievalServiceEnv } from "../src/main";

const token = "w".repeat(40);

function env(overrides: Partial<RetrievalServiceEnv> = {}): RetrievalServiceEnv {
  return {
    PORT: "0",
    HOST: "127.0.0.1",
    WORKLOAD_TOKEN: token,
    PDP_URL: "",
    PDP_WORKLOAD_TOKEN: "",
    INDEX_URL: "",
    INDEX_WORKLOAD_TOKEN: "",
    CONTENT_URL: "",
    CONTENT_WORKLOAD_TOKEN: "",
    AUDIT_URL: "",
    AUDIT_WORKLOAD_TOKEN: "",
    PUBLICATION_URL: "",
    PUBLICATION_WORKLOAD_TOKEN: "",
    NODE_ENV: "production",
    ALLOW_LOOPBACK_HTTP: "",
    ...overrides,
  };
}

describe("retrieval main local composition", () => {
  let running: { close: () => Promise<void>; service: RetrievalDeployment["service"] } | undefined;

  afterEach(async () => {
    await running?.close();
    running = undefined;
  });

  it("fails closed when local composition is enabled outside development or test", async () => {
    await expect(main(env({ LENS_RETRIEVAL_LOCAL_COMPOSE: "true" }))).rejects.toThrow(
      "LENS_RETRIEVAL_LOCAL_COMPOSE is only allowed in development or test.",
    );
  });

  it("serves an injected local deployment in test", async () => {
    const deployment: RetrievalDeployment = createRetrievalDeployment({});
    running = await main(
      env({ NODE_ENV: "test", LENS_RETRIEVAL_LOCAL_COMPOSE: "true" }),
      { deployment },
    );
    expect(running.service).toBe(deployment.service);
  });
});
