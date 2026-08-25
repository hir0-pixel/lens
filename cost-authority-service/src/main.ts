import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { AuthorityReceiptIssuer } from "../../services/security/authorityReceipt";
import { SqliteCostAuthority } from "../../services/cost-authority/SqliteCostAuthority";
import { PostgresCostAuthority } from "../../services/cost-authority/PostgresCostAuthority";
import { CostAuthorityError, type CostAuthorityPort } from "../../services/cost-authority/CostAuthority";
import { createInternalServiceHttp } from "../../services/internal-http/internalServiceHttp";
import { PostgresPool } from "../../services/storage/pgPool";

export interface CostAuthorityServiceEnv {
  PORT?: string;
  HOST?: string;
  COST_WORKLOAD_TOKEN: string;
  COST_STORAGE_PROFILE?: string;
  COST_DB_PATH?: string;
  COST_DATABASE_URL?: string;
  COST_SIGNING_KEY?: string;
}

function loadEnv(): CostAuthorityServiceEnv {
  return {
    PORT: process.env.PORT ?? "8791",
    HOST: process.env.HOST ?? "127.0.0.1",
    COST_WORKLOAD_TOKEN: process.env.LENS_COST_AUTHORITY_WORKLOAD_TOKEN ?? "",
    COST_STORAGE_PROFILE: process.env.LENS_COST_AUTHORITY_STORAGE_PROFILE,
    COST_DB_PATH: process.env.LENS_COST_AUTHORITY_DB_PATH,
    COST_DATABASE_URL: process.env.LENS_COST_AUTHORITY_DATABASE_URL,
    COST_SIGNING_KEY: process.env.LENS_COST_AUTHORITY_SIGNING_KEY,
  };
}

function parseProfile(value: string | undefined): "development" | "test" | "production" {
  if (value === "development" || value === "test" || value === "production") return value;
  throw new Error("LENS_COST_AUTHORITY_STORAGE_PROFILE must be development, test, or production.");
}

function loadSigningKey(env: CostAuthorityServiceEnv): string {
  if (env.COST_SIGNING_KEY) return env.COST_SIGNING_KEY.includes("BEGIN") ? env.COST_SIGNING_KEY : readFileSync(env.COST_SIGNING_KEY, "utf8");
  throw new Error("LENS_COST_AUTHORITY_SIGNING_KEY is required (PEM or file path).");
}

export async function main(env: CostAuthorityServiceEnv = loadEnv()): Promise<{ close: () => Promise<void> }> {
  if (env.COST_WORKLOAD_TOKEN.length < 32) throw new Error("LENS_COST_AUTHORITY_WORKLOAD_TOKEN must contain at least 32 characters.");
  const profile = parseProfile(env.COST_STORAGE_PROFILE);
  const issuer = new AuthorityReceiptIssuer(loadSigningKey(env));
  let authority: CostAuthorityPort & { ready?: () => Promise<void>; close?: () => void };
  let postgres: PostgresPool | undefined;
  if (profile === "production") {
    if (!env.COST_DATABASE_URL) throw new Error("Production Cost authority requires LENS_COST_AUTHORITY_DATABASE_URL.");
    if (env.COST_DB_PATH) throw new Error("SQLite is development/test-only for the Cost authority.");
    postgres = new PostgresPool(env.COST_DATABASE_URL);
    await postgres.connect();
    if (!(await postgres.ready())) throw new Error("Cost authority PostgreSQL is not ready.");
    const pgAuthority = new PostgresCostAuthority(postgres, issuer);
    await pgAuthority.ready();
    authority = pgAuthority;
  } else {
    if (!env.COST_DB_PATH) throw new Error(`LENS_COST_AUTHORITY_DB_PATH is required for ${profile}.`);
    authority = new SqliteCostAuthority(env.COST_DB_PATH, issuer);
  }

  const http = createInternalServiceHttp({
    workloadToken: env.COST_WORKLOAD_TOKEN,
    tokenHeader: "x-lens-cost-token",
    routes: {
      "/v1/cost/reservations": async (body) => {
        const result = await authority.reserveWorkflowBudget({
          requestId: String(body.request_id),
          turnId: String(body.turn_id),
          reservationRef: String(body.reservation_ref),
          idempotencyKey: String(body.idempotency_key),
          subEnvelopes: body.sub_envelopes as never,
          expiresAt: Number(body.expires_at),
          workflowProfileDigest: body.workflow_profile_digest as `sha256:${string}` | undefined,
        }, new AbortController().signal);
        return { reservation_ref: result.reservationRef, revision: result.revision };
      },
      "/v1/cost/consume": async (body) => {
        const receipt = await authority.consumeSubEnvelope({
          reservationRef: String(body.reservation_ref),
          subEnvelope: body.sub_envelope as never,
          units: Number(body.units),
          requestId: String(body.request_id),
          turnId: String(body.turn_id),
          stepId: String(body.step_id),
          idempotencyKey: String(body.idempotency_key),
          expiresAt: Number(body.expires_at),
        }, new AbortController().signal);
        return receipt as unknown as Record<string, unknown>;
      },
      "/v1/cost/finalize": async (body) => {
        await authority.finalizeSubEnvelope({
          reservationRef: String(body.reservation_ref),
          subEnvelope: body.sub_envelope as never,
          measuredUnits: Number(body.measured_units),
          idempotencyKey: String(body.idempotency_key),
        }, new AbortController().signal);
      },
      "/v1/cost/close": async (body) => {
        await authority.closeWorkflowBudget(String(body.reservation_ref), new AbortController().signal);
      },
      "/v1/cost/status": async (body) => {
        return await authority.getWorkflowBudgetStatus(String(body.reservation_ref), new AbortController().signal) as unknown as Record<string, unknown>;
      },
    },
    mapError: (error) => {
      if (error instanceof CostAuthorityError) {
        const status = error.code === "CONFLICT" ? 409 : error.code === "OVERSPEND" || error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" ? 404 : 503;
        return { status, body: { error: error.code } };
      }
      return { status: 500, body: { error: "INTERNAL" } };
    },
  });

  http.setReady(true);
  const port = Number(env.PORT ?? "8791");
  await http.listen(port, env.HOST ?? "127.0.0.1");
  return {
    close: async () => {
      await http.close();
      authority.close?.();
      await postgres?.close();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(() => { process.exitCode = 1; });
}
