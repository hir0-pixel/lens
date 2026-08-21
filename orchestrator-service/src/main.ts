import { pathToFileURL } from "node:url";
import { AuthorityHttpClient } from "./authorityClient";
import { createOrchestratorHttp } from "./http";
import { InternalInferenceClient } from "./internalInferenceClient";
import { RetrievalHttpClient } from "./retrievalClient";
import { ProductionOrchestratorService } from "./service";

export interface OrchestratorServiceEnv {
  PORT?: string;
  HOST?: string;
  ORCHESTRATOR_WORKLOAD_TOKEN: string;
  RETRIEVAL_URL: string;
  RETRIEVAL_WORKLOAD_TOKEN: string;
  MODEL_RUNTIME_URL: string;
  MODEL_RUNTIME_WORKLOAD_TOKEN: string;
  MODEL_ARTIFACT_DIGEST: `sha256:${string}` | string;
  AUTHORITY_URL: string;
  AUTHORITY_WORKLOAD_TOKEN: string;
}

function loadEnv(): OrchestratorServiceEnv {
  return {
    PORT: process.env.PORT ?? "8789",
    HOST: process.env.HOST ?? "127.0.0.1",
    ORCHESTRATOR_WORKLOAD_TOKEN: process.env.LENS_ORCHESTRATOR_WORKLOAD_TOKEN ?? "",
    RETRIEVAL_URL: process.env.LENS_RETRIEVAL_URL ?? "",
    RETRIEVAL_WORKLOAD_TOKEN: process.env.LENS_RETRIEVAL_WORKLOAD_TOKEN ?? "",
    MODEL_RUNTIME_URL: process.env.LENS_MODEL_RUNTIME_URL ?? "",
    MODEL_RUNTIME_WORKLOAD_TOKEN: process.env.LENS_MODEL_RUNTIME_WORKLOAD_TOKEN ?? "",
    MODEL_ARTIFACT_DIGEST: process.env.LENS_MODEL_ARTIFACT_DIGEST ?? "",
    AUTHORITY_URL: process.env.LENS_AUTHORITY_URL ?? "",
    AUTHORITY_WORKLOAD_TOKEN: process.env.LENS_AUTHORITY_WORKLOAD_TOKEN ?? "",
  };
}

export async function main(env: OrchestratorServiceEnv = loadEnv()): Promise<{ close: () => Promise<void> }> {
  if (env.ORCHESTRATOR_WORKLOAD_TOKEN.length < 32) {
    throw new Error("LENS_ORCHESTRATOR_WORKLOAD_TOKEN must contain at least 32 characters.");
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(env.MODEL_ARTIFACT_DIGEST)) {
    throw new Error("LENS_MODEL_ARTIFACT_DIGEST must be a sha256 digest.");
  }
  const port = Number(env.PORT ?? "8789");
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error("PORT must be an integer from 1 to 65535.");
  const retrieval = new RetrievalHttpClient(env.RETRIEVAL_URL, env.RETRIEVAL_WORKLOAD_TOKEN);
  const inference = new InternalInferenceClient(env.MODEL_RUNTIME_URL, env.MODEL_RUNTIME_WORKLOAD_TOKEN);
  const authority = new AuthorityHttpClient(env.AUTHORITY_URL, env.AUTHORITY_WORKLOAD_TOKEN);
  const service = new ProductionOrchestratorService({
    retrieval,
    scheduler: inference,
    runtime: inference,
    generationContextFence: authority,
    auditAdmission: authority,
    outputGuards: authority,
    outputStore: authority,
    turnState: authority,
    disclosure: authority,
    resultAuthorization: authority,
    modelArtifactDigest: env.MODEL_ARTIFACT_DIGEST as `sha256:${string}`,
  });
  const http = createOrchestratorHttp({
    workloadToken: env.ORCHESTRATOR_WORKLOAD_TOKEN,
    handleChat: (request, signal) => service.handleChat(request, signal),
  });
  await http.listen(port, env.HOST ?? "127.0.0.1");
  return { close: () => http.close() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().then(({ close }) => {
    let closing = false;
    const shutdown = (): void => {
      if (closing) return;
      closing = true;
      void close().finally(() => process.exit(0));
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
  }).catch(() => {
    process.exitCode = 1;
  });
}
