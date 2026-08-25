/**
 * Production SQL port: PostgreSQL dialect (`$1` placeholders) via a declared `pg.Pool`.
 * Development/test uses `SqlitePgCompatPool` over `node:sqlite`. Production Cost/Agent-run/
 * attempt-store services require a `postgres://` or `postgresql://` URL and fail closed
 * otherwise. SQLite is never a production fallback.
 */
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { RUNTIME_ATTEMPT_SCHEMA } from "../runtime-attempt/RuntimeAttemptStore";

export interface PgResult<T> {
  rows: T[];
  rowCount: number;
}

export type PgQuery = <T = Record<string, unknown>>(text: string, values?: unknown[]) => Promise<PgResult<T>>;

export interface PgPool {
  query: PgQuery;
  transaction<T>(fn: (query: PgQuery) => Promise<T>): Promise<T>;
  ready(): Promise<boolean>;
  close(): Promise<void>;
}

export interface PostgresPoolOptions {
  max?: number;
  connectionTimeoutMillis?: number;
  idleTimeoutMillis?: number;
  queryTimeoutMillis?: number;
}

const sqliteWriteLocks = new Map<string, Promise<void>>();

function enqueueSqliteWrite(lockKey: string): { wait: Promise<void>; release: () => void } {
  const previous = sqliteWriteLocks.get(lockKey) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  sqliteWriteLocks.set(lockKey, previous.then(() => current));
  return { wait: previous, release };
}

function toSqlite(text: string): string {
  return text
    .replace(/\bLEAST\s*\(/gi, "MIN(")
    .replace(/\bGREATEST\s*\(/gi, "MAX(")
    .replace(/\bFOR UPDATE\b/gi, "")
    .replace(/\$(\d+)/g, "?");
}

function assertInternalPostgresUrl(connectionString: string): void {
  if (!/^postgres(ql)?:\/\//i.test(connectionString)) {
    throw new Error("Production SQL requires a postgres:// or postgresql:// connection string.");
  }
  try {
    const parsed = new URL(connectionString.replace(/^postgresql:/i, "postgres:"));
    const host = parsed.hostname.toLowerCase();
    const internal = host === "localhost" || host === "127.0.0.1" || host.endsWith(".internal") || host === "postgres";
    if (!internal) throw new Error("PostgreSQL host must be loopback or *.internal.");
  } catch (error) {
    if (error instanceof Error && error.message.includes("must be")) throw error;
    throw new Error("Production SQL connection string is invalid.");
  }
}

const sqlitePools = new Map<string, SqlitePgCompatPool>();

/** Development/test adapter: PostgreSQL-shaped SQL executed on SQLite. */
export class SqlitePgCompatPool implements PgPool {
  private refs = 1;
  private closed = false;

  constructor(private readonly db: DatabaseSync, private readonly lockKey: string) {}

  retain(): this {
    this.refs += 1;
    return this;
  }

  async query<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<PgResult<T>> {
    const lock = enqueueSqliteWrite(this.lockKey);
    await lock.wait;
    try {
      return this.run(text, values);
    } finally {
      lock.release();
    }
  }

  async transaction<T>(fn: (query: PgQuery) => Promise<T>): Promise<T> {
    const lock = enqueueSqliteWrite(this.lockKey);
    await lock.wait;
    try {
      this.db.exec("BEGIN IMMEDIATE");
      const result = await fn(async (text, values) => this.run(text, values ?? []));
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* ignore rollback failure */ }
      throw error;
    } finally {
      lock.release();
    }
  }

  async ready(): Promise<boolean> {
    const result = this.db.prepare("SELECT 1 AS ok").get() as { ok: number } | undefined;
    return result?.ok === 1;
  }

  async close(): Promise<void> {
    this.closeSync();
  }

  closeSync(): void {
    this.refs -= 1;
    if (this.refs > 0 || this.closed) return;
    this.closed = true;
    this.db.close();
    sqlitePools.delete(this.lockKey);
  }

  private run<T>(text: string, values: unknown[]): PgResult<T> {
    const sql = toSqlite(text);
    const trimmed = sql.trim();
    const upper = trimmed.toUpperCase();
    const params = values as never[];
    if (upper.startsWith("SELECT") || upper.startsWith("WITH")) {
      const rows = this.db.prepare(sql).all(...params) as T[];
      return { rows, rowCount: rows.length };
    }
    try {
      const result = this.db.prepare(sql).run(...params);
      return { rows: [], rowCount: Number(result.changes) };
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/UNIQUE|PRIMARY KEY/i.test(message)) {
        return { rows: [], rowCount: 0 };
      }
      throw error;
    }
  }
}

export function createSqlitePgCompatPool(dbPath: string): SqlitePgCompatPool {
  const isolated = dbPath === ":memory:" ? `:memory:${randomUUID()}` : dbPath;
  const existing = sqlitePools.get(isolated);
  if (existing) return existing.retain();
  const db = new DatabaseSync(dbPath === ":memory:" ? ":memory:" : dbPath);
  db.exec("PRAGMA journal_mode = DELETE;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(RUNTIME_ATTEMPT_SCHEMA);
  const pool = new SqlitePgCompatPool(db, isolated);
  sqlitePools.set(isolated, pool);
  return pool;
}

export function rewritePostgresSqlForSqlite(text: string): string {
  return toSqlite(text);
}

/**
 * Production PostgreSQL pool using the declared `pg` driver. Never falls back to SQLite.
 */
export class PostgresPool implements PgPool {
  private pool: {
    query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }>;
    connect: () => Promise<{ query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }>; release: () => void }>;
    end: () => Promise<void>;
  } | undefined;

  constructor(
    private readonly connectionString: string,
    private readonly options: PostgresPoolOptions = {},
  ) {
    assertInternalPostgresUrl(connectionString);
  }

  async connect(): Promise<void> {
    let PoolCtor: new (config: Record<string, unknown>) => NonNullable<PostgresPool["pool"]>;
    try {
      PoolCtor = createRequire(import.meta.url)("pg").Pool as typeof PoolCtor;
    } catch {
      throw new Error("Production PostgreSQL requires the declared pg driver; SQLite is not accepted.");
    }
    this.pool = new PoolCtor({
      connectionString: this.connectionString,
      max: this.options.max ?? 10,
      connectionTimeoutMillis: this.options.connectionTimeoutMillis ?? 5_000,
      idleTimeoutMillis: this.options.idleTimeoutMillis ?? 10_000,
      statement_timeout: this.options.queryTimeoutMillis ?? 15_000,
    });
  }

  async ready(): Promise<boolean> {
    if (!this.pool) throw new Error("PostgreSQL pool is not connected.");
    const result = await this.pool.query("SELECT 1 AS ok");
    return Number((result.rows[0] as { ok: number } | undefined)?.ok) === 1;
  }

  async query<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<PgResult<T>> {
    if (!this.pool) throw new Error("PostgreSQL pool is not connected.");
    const result = await this.pool.query(text, values);
    return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
  }

  async transaction<T>(fn: (query: PgQuery) => Promise<T>): Promise<T> {
    if (!this.pool) throw new Error("PostgreSQL pool is not connected.");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(async (text, values) => {
        const queried = await client.query(text, values);
        return { rows: queried.rows as never[], rowCount: queried.rowCount ?? 0 };
      });
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool?.end();
    this.pool = undefined;
  }
}
