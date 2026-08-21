import { RetrievalService } from "../../services/retrieval/RetrievalService";
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

export async function main(env: RetrievalServiceEnv = loadEnv()): Promise<{ close: () => Promise<void>; service: RetrievalService }> {
  const workloadToken = requireToken("LENS_RETRIEVAL_WORKLOAD_TOKEN", env.WORKLOAD_TOKEN);
  const dependencies = createRetrievalDependencyClients(dependencyConfig(env));
  const service = new RetrievalService(
    dependencies.pdp,
    dependencies.index,
    dependencies.content,
    dependencies.audit,
    dependencies.publication,
  );

  const http = createRetrievalHttp({
    service,
    workloadToken,
  });

  const port = Number(env.PORT ?? "8788");
  const host = env.HOST ?? "127.0.0.1";
  await http.listen(port, host);

  return {
    close: async () => {
      await http.close();
    },
    service,
  };
}
