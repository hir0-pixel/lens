import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export interface SecretStore {
  put(secretRef: string, plaintext: string): Promise<void>;
  get(secretRef: string): Promise<string>;
  delete(secretRef: string): Promise<void>;
}

const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function assertSecretRef(secretRef: string): void {
  if (!REF_PATTERN.test(secretRef) || secretRef.includes("/") || secretRef.includes("\\") || secretRef.includes(" ")) {
    throw new Error("secret_ref must be a token name.");
  }
}

/** In-process store. Plaintext lives only in this Map — never mirrored to process.env. Never logs values. */
export class MemorySecretStore implements SecretStore {
  private readonly secrets = new Map<string, string>();

  async put(secretRef: string, plaintext: string): Promise<void> {
    assertSecretRef(secretRef);
    if (plaintext.length < 8) throw new Error("Provider key is too short.");
    this.secrets.set(secretRef, plaintext);
  }

  async get(secretRef: string): Promise<string> {
    assertSecretRef(secretRef);
    const value = this.secrets.get(secretRef);
    if (!value || value.length < 8) throw new Error("Secret is missing.");
    return value;
  }

  async delete(secretRef: string): Promise<void> {
    assertSecretRef(secretRef);
    this.secrets.delete(secretRef);
  }
}

/** AES-256-GCM sealed secrets. Plaintext never written to the registry table. */
export class EncryptedSqliteSecretStore implements SecretStore {
  private readonly key: Buffer;
  private readonly db: DatabaseSync;

  constructor(databasePath: string, masterKey: string) {
    if (masterKey.length < 32) throw new Error("SECRET_STORE_KEY must be at least 32 characters.");
    this.key = createHash("sha256").update(masterKey).digest();
    this.db = new DatabaseSync(databasePath);
    this.db.exec(`CREATE TABLE IF NOT EXISTS sealed_secrets (
      secret_ref TEXT PRIMARY KEY,
      nonce BLOB NOT NULL,
      tag BLOB NOT NULL,
      ciphertext BLOB NOT NULL
    )`);
  }

  async put(secretRef: string, plaintext: string): Promise<void> {
    assertSecretRef(secretRef);
    if (plaintext.length < 8) throw new Error("Provider key is too short.");
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    this.db.prepare(
      `INSERT INTO sealed_secrets (secret_ref, nonce, tag, ciphertext) VALUES (?, ?, ?, ?)
       ON CONFLICT(secret_ref) DO UPDATE SET nonce=excluded.nonce, tag=excluded.tag, ciphertext=excluded.ciphertext`,
    ).run(secretRef, nonce, tag, ciphertext);
  }

  async get(secretRef: string): Promise<string> {
    assertSecretRef(secretRef);
    const row = this.db.prepare("SELECT nonce, tag, ciphertext FROM sealed_secrets WHERE secret_ref = ?").get(secretRef) as
      | { nonce: Buffer; tag: Buffer; ciphertext: Buffer }
      | undefined;
    if (!row) throw new Error("Secret is missing.");
    const decipher = createDecipheriv("aes-256-gcm", this.key, row.nonce);
    decipher.setAuthTag(row.tag);
    return Buffer.concat([decipher.update(row.ciphertext), decipher.final()]).toString("utf8");
  }

  async delete(secretRef: string): Promise<void> {
    assertSecretRef(secretRef);
    this.db.prepare("DELETE FROM sealed_secrets WHERE secret_ref = ?").run(secretRef);
  }
}
