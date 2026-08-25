import { RetrievalService } from "../../services/retrieval/RetrievalService";
import { createRetrievalDeployment, type RetrievalDeployment } from "../../services/retrieval/ProductionRetrievalWiring";
import { createRetrievalDependencyClients, type RetrievalDependencyClientConfig } from "./adapters";
import { createRetrievalHttp } from "./http";

export interface RetrievalServiceEnv {
  PORT?: string;
  HOST?: string;
  WORKLOAD_TOKEN: string;
  PDP_URL: string;
  PDP_WORKLOAD_TOKEN: string;
  INDEX_URL: string;
  INDEX_WORKLOAD_TOKEN: string;
  CONTENT_URL: string;
  CONTENT_WORKLOAD_TOKEN: string;
  AUDIT_URL: string;
  AUDIT_WORKLOAD_TOKEN: string;
  PUBLICATION_URL: string;
  PUBLICATION_WORKLOAD_TOKEN: string;
  NODE_ENV?: string;
  ALLOW_LOOPBACK_HTTP?: string;
  LENS_RETRIEVAL_LOCAL_COMPOSE?: string;
  LENS_RETRIEVAL_LOCAL_PERSISTENCE_PATH?: string;
  LENS_RETRIEVAL_LOCAL_PUBLICATION_STORE_PATH?: string;
}

export interface RetrievalMainDependencies {
  deployment?: RetrievalDeployment;
}

function loadEnv(): RetrievalServiceEnv {
  return {
    PORT: process.env.PORT ?? "8788",
    HOST: process.env.HOST ?? "127.0.0.1",
    WORKLOAD_TOKEN: process.env.LENS_RETRIEVAL_WORKLOAD_TOKEN ?? "",
    PDP_URL: process.env.LENS_RETRIEVAL_PDP_URL ?? "",
    PDP_WORKLOAD_TOKEN: process.env.LENS_RETRIEVAL_PDP_WORKLOAD_TOKEN ?? "",
    INDEX_URL: process.env.LENS_RETRIEVAL_INDEX_URL ?? "",
    INDEX_WORKLOAD_TOKEN: process.env.LENS_RETRIEVAL_INDEX_WORKLOAD_TOKEN ?? "",
    CONTENT_URL: process.env.LENS_RETRIEVAL_CONTENT_URL ?? "",
    CONTENT_WORKLOAD_TOKEN: process.env.LENS_RETRIEVAL_CONTENT_WORKLOAD_TOKEN ?? "",
    AUDIT_URL: process.env.LENS_RETRIEVAL_AUDIT_URL ?? "",
    AUDIT_WORKLOAD_TOKEN: process.env.LENS_RETRIEVAL_AUDIT_WORKLOAD_TOKEN ?? "",
    PUBLICATION_URL: process.env.LENS_RETRIEVAL_PUBLICATION_URL ?? "",
    PUBLICATION_WORKLOAD_TOKEN: process.env.LENS_RETRIEVAL_PUBLICATION_WORKLOAD_TOKEN ?? "",
    NODE_ENV: process.env.NODE_ENV ?? "production",
    ALLOW_LOOPBACK_HTTP: process.env.LENS_RETRIEVAL_ALLOW_LOOPBACK_HTTP ?? "",
    LENS_RETRIEVAL_LOCAL_COMPOSE: process.env.LENS_RETRIEVAL_LOCAL_COMPOSE,
    LENS_RETRIEVAL_LOCAL_PERSISTENCE_PATH: process.env.LENS_RETRIEVAL_LOCAL_PERSISTENCE_PATH,
    LENS_RETRIEVAL_LOCAL_PUBLICATION_STORE_PATH: process.env.LENS_RETRIEVAL_LOCAL_PUBLICATION_STORE_PATH,
  };
}

function requireToken(name: string, value: string): string {
  if (value.length < 32) throw new Error(`${name} must contain at least 32 characters.`);
  return value;
}

function requireUrl(name: string, value: string): string {
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function dependencyConfig(env: RetrievalServiceEnv): RetrievalDependencyClientConfig {
  const allowLoopbackHttp = env.ALLOW_LOOPBACK_HTTP === "true" && (env.NODE_ENV === "test" || env.NODE_ENV === "development");
  return {
    pdp: {
      baseUrl: requireUrl("LENS_RETRIEVAL_PDP_URL", env.PDP_URL),
      credential: requireToken("LENS_RETRIEVAL_PDP_WORKLOAD_TOKEN", env.PDP_WORKLOAD_TOKEN),
      allowLoopbackHttp,
    },
    index: {
      baseUrl: requireUrl("LENS_RETRIEVAL_INDEX_URL", env.INDEX_URL),
      credential: requireToken("LENS_RETRIEVAL_INDEX_WORKLOAD_TOKEN", env.INDEX_WORKLOAD_TOKEN),
      allowLoopbackHttp,
    },
    content: {
      baseUrl: requireUrl("LENS_RETRIEVAL_CONTENT_URL", env.CONTENT_URL),
      credential: requireToken("LENS_RETRIEVAL_CONTENT_WORKLOAD_TOKEN", env.CONTENT_WORKLOAD_TOKEN),
      allowLoopbackHttp,
    },
    audit: {
      baseUrl: requireUrl("LENS_RETRIEVAL_AUDIT_URL", env.AUDIT_URL),
      credential: requireToken("LENS_RETRIEVAL_AUDIT_WORKLOAD_TOKEN", env.AUDIT_WORKLOAD_TOKEN),
      allowLoopbackHttp,
    },
    publication: {
      baseUrl: requireUrl("LENS_RETRIEVAL_PUBLICATION_URL", env.PUBLICATION_URL),
      credential: requireToken("LENS_RETRIEVAL_PUBLICATION_WORKLOAD_TOKEN", env.PUBLICATION_WORKLOAD_TOKEN),
      allowLoopbackHttp,
    },
  };
}

const READINESS_TTL_MS = 5_000;

/** Construct the real in-process retrieval deployment used only by local composition. */
export function composeLocalRetrievalDeployment(env: RetrievalServiceEnv): RetrievalDeployment {
  return createRetrievalDeployment({
    persistencePath: env.LENS_RETRIEVAL_LOCAL_PERSISTENCE_PATH,
    publicationStorePath: env.LENS_RETRIEVAL_LOCAL_PUBLICATION_STORE_PATH,
  });
}

export async function main(
  env: RetrievalServiceEnv = loadEnv(),
  dependencies: RetrievalMainDependencies = {},
): Promise<{ close: () => Promise<void>; service: RetrievalService }> {
  // Local composition is deliberately unreachable in production: it uses
  // process-local authorities and stores, not deployer's production services.
  if (env.LENS_RETRIEVAL_LOCAL_COMPOSE === "true" && env.NODE_ENV !== "development" && env.NODE_ENV !== "test") {
    throw new Error("LENS_RETRIEVAL_LOCAL_COMPOSE is only allowed in development or test.");
  }

  const workloadToken = requireToken("LENS_RETRIEVAL_WORKLOAD_TOKEN", env.WORKLOAD_TOKEN);
  const port = Number(env.PORT ?? "8788");
  const host = env.HOST ?? "127.0.0.1";

  if (env.LENS_RETRIEVAL_LOCAL_COMPOSE === "true") {
    const deployment = dependencies.deployment ?? composeLocalRetrievalDeployment(env);
    const http = createRetrievalHttp({ service: deployment.service, workloadToken, readiness: () => true });
    await http.listen(port, host);
    return { close: () => http.close(), service: deployment.service };
  }

  const remoteDependencies = createRetrievalDependencyClients(dependencyConfig(env));
  const service = new RetrievalService(
    remoteDependencies.pdp,
    remoteDependencies.index,
    remoteDependencies.content,
    remoteDependencies.audit,
    remoteDependencies.publication,
  );

  // Fail closed: readiness starts false and only flips true once every
  // dependency confirms it is reachable. A bounded, short-TTL cache is
  // refreshed on an interval so probes never trigger unbounded dependency load.
  let ready = false;
  const refreshReadiness = async (): Promise<void> => {
    ready = await remoteDependencies.health.check().catch(() => false);
  };
  await refreshReadiness();

  const http = createRetrievalHttp({ service, workloadToken, readiness: () => ready });
  const readinessTimer = setInterval(() => {
    void refreshReadiness().then(() => http.setReadiness(ready));
  }, READINESS_TTL_MS);
  readinessTimer.unref();

  await http.listen(port, host);
  return {
    close: async () => {
      clearInterval(readinessTimer);
      await http.close();
    },
    service,
  };
}
