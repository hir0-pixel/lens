import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { AdapterType, ProviderProfile } from "../model-provider/ProviderAdapter";

export type ProviderState = "active" | "disabled" | "unhealthy";

export interface ProviderRecord {
  id: string;
  adapterType: AdapterType;
  baseUrl: string;
  secretRef: string;
  tlsWorkloadRef: string;
  allowedModels: readonly string[];
  capabilities: readonly string[];
  timeoutMs: number;
  maxConcurrency: number;
  profile: ProviderProfile;
  state: ProviderState;
  catalogVersion: number;
  catalogModelIds: readonly string[];
  idempotencyKey: string;
  inputDigest: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProviderWriteInput {
  adapterType: AdapterType;
  baseUrl: string;
  secretRef: string;
  tlsWorkloadRef: string;
  allowedModels: readonly string[];
  capabilities: readonly string[];
  timeoutMs: number;
  maxConcurrency: number;
  profile: ProviderProfile;
  state: ProviderState;
  catalogVersion: number;
  catalogModelIds: readonly string[];
  idempotencyKey: string;
  inputDigest: string;
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super("IDEMPOTENCY_CONFLICT");
    this.name = "IdempotencyConflictError";
  }
}

export interface ProviderRegistry {
  create(input: ProviderWriteInput): Promise<ProviderRecord>;
  update(id: string, patch: Partial<Pick<ProviderRecord, "state" | "catalogVersion" | "catalogModelIds" | "allowedModels" | "timeoutMs" | "maxConcurrency" | "tlsWorkloadRef">>): Promise<ProviderRecord>;
  get(id: string): Promise<ProviderRecord | undefined>;
  getByIdempotencyKey(key: string): Promise<ProviderRecord | undefined>;
  listActive(): Promise<readonly ProviderRecord[]>;
}

function rowToRecord(row: Record<string, unknown>): ProviderRecord {
  return {
    id: String(row.id),
    adapterType: row.adapter_type as AdapterType,
    baseUrl: String(row.base_url),
    secretRef: String(row.secret_ref),
    tlsWorkloadRef: String(row.tls_workload_ref),
    allowedModels: JSON.parse(String(row.allowed_models)) as string[],
    capabilities: JSON.parse(String(row.capabilities)) as string[],
    timeoutMs: Number(row.timeout_ms),
    maxConcurrency: Number(row.max_concurrency),
    profile: row.profile as ProviderProfile,
    state: row.state as ProviderState,
    catalogVersion: Number(row.catalog_version),
    catalogModelIds: JSON.parse(String(row.catalog_model_ids)) as string[],
    idempotencyKey: String(row.idempotency_key),
    inputDigest: String(row.input_digest),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export class SqliteProviderRegistry implements ProviderRegistry {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    this.db = new DatabaseSync(databasePath);
    this.db.exec(`CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      adapter_type TEXT NOT NULL,
      base_url TEXT NOT NULL,
      secret_ref TEXT NOT NULL,
      tls_workload_ref TEXT NOT NULL,
      allowed_models TEXT NOT NULL,
      capabilities TEXT NOT NULL,
      timeout_ms INTEGER NOT NULL,
      max_concurrency INTEGER NOT NULL,
      profile TEXT NOT NULL,
      state TEXT NOT NULL,
      catalog_version INTEGER NOT NULL,
      catalog_model_ids TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      input_digest TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
  }

  async create(input: ProviderWriteInput): Promise<ProviderRecord> {
    const existing = await this.getByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      if (existing.inputDigest !== input.inputDigest) throw new IdempotencyConflictError();
      return existing;
    }
    const now = Date.now();
    const id = `prv_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
    try {
      this.db.prepare(
        `INSERT INTO providers (
          id, adapter_type, base_url, secret_ref, tls_workload_ref, allowed_models, capabilities,
          timeout_ms, max_concurrency, profile, state, catalog_version, catalog_model_ids,
          idempotency_key, input_digest, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.adapterType,
        input.baseUrl,
        input.secretRef,
        input.tlsWorkloadRef,
        JSON.stringify(input.allowedModels),
        JSON.stringify(input.capabilities),
        input.timeoutMs,
        input.maxConcurrency,
        input.profile,
        input.state,
        input.catalogVersion,
        JSON.stringify(input.catalogModelIds),
        input.idempotencyKey,
        input.inputDigest,
        now,
        now,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("UNIQUE")) throw new IdempotencyConflictError();
      throw error;
    }
    const created = await this.get(id);
    if (!created) throw new Error("Provider persist failed.");
    return created;
  }

  async update(id: string, patch: Partial<Pick<ProviderRecord, "state" | "catalogVersion" | "catalogModelIds" | "allowedModels" | "timeoutMs" | "maxConcurrency" | "tlsWorkloadRef">>): Promise<ProviderRecord> {
    const current = await this.get(id);
    if (!current) throw new Error("Provider not found.");
    const next: ProviderRecord = {
      ...current,
      ...patch,
      updatedAt: Date.now(),
    };
    this.db.prepare(
      `UPDATE providers SET state=?, catalog_version=?, catalog_model_ids=?, allowed_models=?, timeout_ms=?, max_concurrency=?, tls_workload_ref=?, updated_at=? WHERE id=?`,
    ).run(
      next.state,
      next.catalogVersion,
      JSON.stringify(next.catalogModelIds),
      JSON.stringify(next.allowedModels),
      next.timeoutMs,
      next.maxConcurrency,
      next.tlsWorkloadRef,
      next.updatedAt,
      id,
    );
    return next;
  }

  async get(id: string): Promise<ProviderRecord | undefined> {
    const row = this.db.prepare("SELECT * FROM providers WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? rowToRecord(row) : undefined;
  }

  async getByIdempotencyKey(key: string): Promise<ProviderRecord | undefined> {
    const row = this.db.prepare("SELECT * FROM providers WHERE idempotency_key = ?").get(key) as Record<string, unknown> | undefined;
    return row ? rowToRecord(row) : undefined;
  }

  async listActive(): Promise<readonly ProviderRecord[]> {
    const rows = this.db.prepare("SELECT * FROM providers").all() as Record<string, unknown>[];
    return rows.map(rowToRecord);
  }
}

export function catalogArtifactDigest(providerId: string, modelId: string, catalogVersion: number): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(`catalog:${providerId}:${modelId}:${catalogVersion}`).digest("hex")}`;
}

export function onboardInputDigest(input: {
  adapterType: string;
  baseUrl: string;
  tlsWorkloadRef: string;
  allowedModels: readonly string[];
  capabilities: readonly string[];
  timeoutMs: number;
  maxConcurrency: number;
  profile: string;
  apiKey: string;
}): string {
  return createHash("sha256").update(JSON.stringify({
    adapterType: input.adapterType,
    baseUrl: input.baseUrl,
    tlsWorkloadRef: input.tlsWorkloadRef,
    allowedModels: [...input.allowedModels].sort(),
    capabilities: [...input.capabilities].sort(),
    timeoutMs: input.timeoutMs,
    maxConcurrency: input.maxConcurrency,
    profile: input.profile,
    keyFingerprint: createHash("sha256").update(input.apiKey).digest("hex"),
  })).digest("hex");
}
