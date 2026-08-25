import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";

const VERSION = "a1";
const MAX_TOKEN_LENGTH = 2_048;
const MAX_TTL_MS = 10_000;
const DEFAULT_TTL_MS = 5_000;
const CLOCK_SKEW_MS = 1_000;
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/;
const MAX_REF_LENGTH = 512;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

export interface DelegatedSessionAssertionBindings {
  issuer: "bff";
  audience: "orchestrator" | "memory";
  requestId: string;
  subjectRef: string;
  sessionRef: string;
  deviceRef: string;
  conversationRef: string;
  queryDigest: `sha256:${string}`;
  /** Server-owned; never client-supplied. See `services/security/workspaceContext.ts`. */
  workspaceRef: string;
  /** Server-owned trusted request classification; never client-supplied. See `services/security/workspaceContext.ts`. */
  requestClass: string;
  /** Server-owned route-policy lookup key; never client-supplied. See `services/security/workspaceContext.ts`. */
  purposeRef: string;
}

export interface DelegatedSessionAssertionClaims extends DelegatedSessionAssertionBindings {
  version: typeof VERSION;
  iat: number;
  exp: number;
}

export class DelegatedSessionAssertionError extends Error {}

function assertRef(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_REF_LENGTH) {
    throw new DelegatedSessionAssertionError(`${field} is invalid.`);
  }
}

function assertBindings(input: DelegatedSessionAssertionBindings): void {
  assertRef(input.requestId, "request_id");
  assertRef(input.subjectRef, "subject_ref");
  assertRef(input.sessionRef, "session_ref");
  assertRef(input.deviceRef, "device_ref");
  assertRef(input.conversationRef, "conversation_ref");
  if (!DIGEST_RE.test(input.queryDigest)) throw new DelegatedSessionAssertionError("query_digest is invalid.");
  assertRef(input.workspaceRef, "workspace_ref");
  assertRef(input.requestClass, "request_class");
  assertRef(input.purposeRef, "purpose_ref");
}

function privateKeyFromPem(value: string | KeyObject): KeyObject {
  try {
    const key = typeof value === "string" ? createPrivateKey(value) : value;
    if (key.type !== "private" || key.asymmetricKeyType !== "ed25519") throw new Error("wrong key type");
    return key;
  } catch {
    throw new DelegatedSessionAssertionError("Delegated assertion signing key must be an Ed25519 private key.");
  }
}

function publicKeyFromPem(value: string | KeyObject): KeyObject {
  try {
    const key = typeof value === "string" ? createPublicKey(value) : value;
    if (key.type !== "public" || key.asymmetricKeyType !== "ed25519") throw new Error("wrong key type");
    return key;
  } catch {
    throw new DelegatedSessionAssertionError("Delegated assertion verification key must be an Ed25519 public key.");
  }
}

function encodePayload(claims: DelegatedSessionAssertionClaims): string {
  return Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
}

function signature(key: KeyObject, payload: string): Buffer {
  return sign(null, Buffer.from(`${VERSION}.${payload}`, "utf8"), key);
}

function decodeCanonicalBase64url(value: unknown, field: string): Buffer {
  if (typeof value !== "string" || value.length === 0 || !BASE64URL_RE.test(value)) {
    throw new DelegatedSessionAssertionError(`${field} encoding is invalid.`);
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length === 0 || decoded.toString("base64url") !== value) {
    throw new DelegatedSessionAssertionError(`${field} encoding is not canonical.`);
  }
  return decoded;
}

function expectedClaimKeys(): string[] {
  return ["audience", "conversationRef", "deviceRef", "exp", "iat", "issuer", "purposeRef", "queryDigest", "requestClass", "requestId", "sessionRef", "subjectRef", "version", "workspaceRef"];
}

export class DelegatedSessionAssertionIssuer {
  private readonly key: KeyObject;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(privateKey: string | KeyObject, options?: { ttlMs?: number; now?: () => number }) {
    this.key = privateKeyFromPem(privateKey);
    this.ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs <= 0 || this.ttlMs > MAX_TTL_MS) {
      throw new DelegatedSessionAssertionError("Delegated session assertion TTL must be between 1ms and 10000ms.");
    }
    this.now = options?.now ?? (() => Date.now());
  }

  issue(bindings: DelegatedSessionAssertionBindings): string {
    assertBindings(bindings);
    const iat = this.now();
    const claims: DelegatedSessionAssertionClaims = { ...bindings, version: VERSION, iat, exp: iat + this.ttlMs };
    const payload = encodePayload(claims);
    const token = `${VERSION}.${payload}.${signature(this.key, payload).toString("base64url")}`;
    if (token.length > MAX_TOKEN_LENGTH) throw new DelegatedSessionAssertionError("Delegated session assertion exceeds the maximum token length.");
    return token;
  }
}

export class DelegatedSessionAssertionVerifier {
  private readonly key: KeyObject;
  private readonly now: () => number;

  constructor(publicKey: string | KeyObject, options?: { now?: () => number }) {
    this.key = publicKeyFromPem(publicKey);
    this.now = options?.now ?? (() => Date.now());
  }

  verify(token: string, expected: DelegatedSessionAssertionBindings): DelegatedSessionAssertionClaims {
    assertBindings(expected);
    if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
      throw new DelegatedSessionAssertionError("Delegated session assertion is invalid.");
    }
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== VERSION || !parts[1] || !parts[2]) {
      throw new DelegatedSessionAssertionError("Delegated session assertion is invalid.");
    }

    decodeCanonicalBase64url(parts[1], "payload");
    const signature = decodeCanonicalBase64url(parts[2], "signature");
    let claims: unknown;
    try {
      claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    } catch {
      throw new DelegatedSessionAssertionError("Delegated session assertion is invalid.");
    }
    if (!claims || typeof claims !== "object" || Array.isArray(claims)) {
      throw new DelegatedSessionAssertionError("Delegated session assertion is invalid.");
    }
    const record = claims as Record<string, unknown>;
    if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(expectedClaimKeys())) {
      throw new DelegatedSessionAssertionError("Delegated session assertion claims are invalid.");
    }

    if (!verify(null, Buffer.from(`${VERSION}.${parts[1]}`, "utf8"), this.key, signature)) {
      throw new DelegatedSessionAssertionError("Delegated session assertion signature is invalid.");
    }

    if (
      record.version !== VERSION ||
      record.issuer !== expected.issuer ||
      record.audience !== expected.audience ||
      record.requestId !== expected.requestId ||
      record.subjectRef !== expected.subjectRef ||
      record.sessionRef !== expected.sessionRef ||
      record.deviceRef !== expected.deviceRef ||
      record.conversationRef !== expected.conversationRef ||
      record.queryDigest !== expected.queryDigest ||
      record.workspaceRef !== expected.workspaceRef ||
      record.requestClass !== expected.requestClass ||
      record.purposeRef !== expected.purposeRef ||
      typeof record.iat !== "number" ||
      typeof record.exp !== "number" ||
      !Number.isSafeInteger(record.iat) ||
      !Number.isSafeInteger(record.exp)
    ) {
      throw new DelegatedSessionAssertionError("Delegated session assertion bindings are invalid.");
    }

    const now = this.now();
    if (record.iat > now + CLOCK_SKEW_MS || record.exp <= now || record.exp <= record.iat || record.exp - record.iat > MAX_TTL_MS) {
      throw new DelegatedSessionAssertionError("Delegated session assertion is expired or outside the allowed lifetime.");
    }
    return record as unknown as DelegatedSessionAssertionClaims;
  }
}
