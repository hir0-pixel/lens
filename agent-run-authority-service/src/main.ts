import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { AuthorityReceiptIssuer } from "../../services/security/authorityReceipt";
import { SqliteAgentRunAuthority } from "../../services/agent-run-authority/SqliteAgentRunAuthority";
import { PostgresAgentRunAuthority } from "../../services/agent-run-authority/PostgresAgentRunAuthority";
import { AgentRunAuthorityError, type AgentRunAuthorityPort } from "../../services/agent-run-authority/AgentRunAuthority";
import { SqliteClaimStore, type ClaimStore } from "../../services/security/replayClaimStore";
import { PostgresClaimStore } from "../../services/security/PostgresClaimStore";
import { createInternalServiceHttp } from "../../services/internal-http/internalServiceHttp";
import { PostgresPool } from "../../services/storage/pgPool";

export interface AgentRunAuthorityServiceEnv {
  PORT?: string;
  HOST?: string;
  AGENT_RUN_WORKLOAD_TOKEN: string;
  AGENT_RUN_STORAGE_PROFILE?: string;
  AGENT_RUN_DB_PATH?: string;
  AGENT_RUN_DATABASE_URL?: string;
  AGENT_RUN_SIGNING_KEY?: string;
}

function loadEnv(): AgentRunAuthorityServiceEnv {
  return {
    PORT: process.env.PORT ?? "8792",
    HOST: process.env.HOST ?? "127.0.0.1",
    AGENT_RUN_WORKLOAD_TOKEN: process.env.LENS_AGENT_RUN_AUTHORITY_WORKLOAD_TOKEN ?? "",
    AGENT_RUN_STORAGE_PROFILE: process.env.LENS_AGENT_RUN_AUTHORITY_STORAGE_PROFILE,
    AGENT_RUN_DB_PATH: process.env.LENS_AGENT_RUN_AUTHORITY_DB_PATH,
    AGENT_RUN_DATABASE_URL: process.env.LENS_AGENT_RUN_AUTHORITY_DATABASE_URL,
    AGENT_RUN_SIGNING_KEY: process.env.LENS_AGENT_RUN_AUTHORITY_SIGNING_KEY,
  };
}

function parseProfile(value: string | undefined): "development" | "test" | "production" {
  if (value === "development" || value === "test" || value === "production") return value;
  throw new Error("LENS_AGENT_RUN_AUTHORITY_STORAGE_PROFILE must be development, test, or production.");
}

function loadSigningKey(env: AgentRunAuthorityServiceEnv): string {
  if (env.AGENT_RUN_SIGNING_KEY) return env.AGENT_RUN_SIGNING_KEY.includes("BEGIN") ? env.AGENT_RUN_SIGNING_KEY : readFileSync(env.AGENT_RUN_SIGNING_KEY, "utf8");
  throw new Error("LENS_AGENT_RUN_AUTHORITY_SIGNING_KEY is required (PEM or file path).");
}

export async function main(env: AgentRunAuthorityServiceEnv = loadEnv()): Promise<{ close: () => Promise<void> }> {
  if (env.AGENT_RUN_WORKLOAD_TOKEN.length < 32) throw new Error("LENS_AGENT_RUN_AUTHORITY_WORKLOAD_TOKEN must contain at least 32 characters.");
  const profile = parseProfile(env.AGENT_RUN_STORAGE_PROFILE);
  const issuer = new AuthorityReceiptIssuer(loadSigningKey(env));
  let authority: AgentRunAuthorityPort & { ready?: () => Promise<void>; close?: () => void };
  let claims: ClaimStore & { ready?: () => Promise<void>; close?: () => void };
  let postgres: PostgresPool | undefined;
  if (profile === "production") {
    if (!env.AGENT_RUN_DATABASE_URL) throw new Error("Production Agent-run authority requires LENS_AGENT_RUN_AUTHORITY_DATABASE_URL.");
    if (env.AGENT_RUN_DB_PATH) throw new Error("SQLite is development/test-only for the Agent-run authority.");
    postgres = new PostgresPool(env.AGENT_RUN_DATABASE_URL);
    await postgres.connect();
    if (!(await postgres.ready())) throw new Error("Agent-run PostgreSQL is not ready.");
    const pgAuthority = new PostgresAgentRunAuthority(postgres, issuer);
    const pgClaims = new PostgresClaimStore(postgres);
    await pgAuthority.ready();
    await pgClaims.ready();
    authority = pgAuthority;
    claims = pgClaims;
  } else {
    if (!env.AGENT_RUN_DB_PATH) throw new Error(`LENS_AGENT_RUN_AUTHORITY_DB_PATH is required for ${profile}.`);
    authority = new SqliteAgentRunAuthority(env.AGENT_RUN_DB_PATH, issuer);
    claims = new SqliteClaimStore(env.AGENT_RUN_DB_PATH);
  }

  const http = createInternalServiceHttp({
    workloadToken: env.AGENT_RUN_WORKLOAD_TOKEN,
    tokenHeader: "x-lens-agent-run-token",
    routes: {
      "/v1/agent-runs/begin": async (body) => {
        const result = await authority.beginAgentRun({
          requestId: String(body.request_id),
          turnId: String(body.turn_id),
          runId: String(body.run_id),
          workflowReservationRef: String(body.workflow_reservation_ref),
          workflowProfileDigest: body.workflow_profile_digest as `sha256:${string}`,
          idempotencyKey: String(body.idempotency_key),
          expiresAt: Number(body.expires_at),
        }, new AbortController().signal);
        return { run_id: result.runId, envelope_revision: result.envelopeRevision };
      },
      "/v1/agent-runs/steps/reserve": async (body) => {
        const receipt = await authority.reserveAgentStep({
          runId: String(body.run_id),
          requestId: String(body.request_id),
          turnId: String(body.turn_id),
          stepId: String(body.step_id),
          stepClass: body.step_class as never,
          stepIndex: Number(body.step_index),
          modelRef: String(body.model_ref),
          artifactDigest: body.artifact_digest as `sha256:${string}`,
          capability: String(body.capability),
          workflowReservationRef: String(body.workflow_reservation_ref),
          subEnvelope: body.sub_envelope as never,
          modelAuthorizationDigest: body.model_authorization_digest as `sha256:${string}`,
          idempotencyKey: String(body.idempotency_key),
          deadlineAt: Number(body.deadline_at),
        }, new AbortController().signal);
        return receipt as unknown as Record<string, unknown>;
      },
      "/v1/agent-runs/steps/consume": async (body) => {
        await authority.consumeAgentStep(String(body.run_id), String(body.step_id), String(body.receipt_id), new AbortController().signal);
      },
      "/v1/agent-runs/steps/finalize": async (body) => {
        await authority.finalizeAgentStep(String(body.run_id), String(body.step_id), new AbortController().signal);
      },
      "/v1/agent-runs/close": async (body) => {
        await authority.closeAgentRun(String(body.run_id), new AbortController().signal);
      },
      "/v1/agent-runs/status": async (body) => {
        return await authority.getAgentRunStatus(String(body.run_id), new AbortController().signal) as unknown as Record<string, unknown>;
      },
      "/v1/claims": async (body) => {
        const claimed = await claims.claim(String(body.kind), String(body.claim_id), String(body.request_id), Number(body.now));
        return { claimed };
      },
    },
    mapError: (error) => {
      if (error instanceof AgentRunAuthorityError) {
        const status = error.code === "CONFLICT" ? 409 : error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" ? 404 : 503;
        return { status, body: { error: error.code } };
      }
      return { status: 500, body: { error: "INTERNAL" } };
    },
  });

  http.setReady(true);
  await http.listen(Number(env.PORT ?? "8792"), env.HOST ?? "127.0.0.1");
  return {
    close: async () => {
      await http.close();
      authority.close?.();
      claims.close?.();
      await postgres?.close();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(() => { process.exitCode = 1; });
}
