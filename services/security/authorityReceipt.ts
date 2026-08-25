/**
 * The single typed, signed receipt shape shared by every shared authority in this repository:
 * PDP AuthorizeGenerate/AuthorizeModelUse decisions, Cost sub-envelope consumption receipts,
 * Doc 014 Agent-step receipts, and Scheduler leases. `ModelGateway.generate()` verifies one of
 * these for each of its inputs instead of checking a nonempty string. One canonicalizer, one
 * signature scheme, one expiry/one-use discipline — reused everywhere rather than five
 * bespoke ad hoc string formats that each have to be independently trusted.
 *
 * One-use enforcement is NOT done here — a receipt only proves it was validly issued and is
 * still live. Claiming it exactly once, including across replicas, is `replayClaimStore.ts`'s
 * job; callers must claim a receipt's `receiptId` there before treating it as consumed.
 */
import { createPrivateKey, createPublicKey, sign as cryptoSign, verify as cryptoVerify, randomUUID, type KeyObject } from "node:crypto";
import { canonicalJson } from "./canonicalJson";

const VERSION = "ar1";
const MAX_TTL_MS = 60_000;

/** What this receipt attests. Each purpose binds a different subset of the optional fields below. */
export type ReceiptPurpose =
  | "authorize_generate"
  | "authorize_model_use"
  | "cost_sub_envelope_consumption"
  | "agent_step"
  | "scheduler_lease";

export type SubEnvelopeClass = "route" | "retrieval" | "final_generation" | "tool";
export type AgentStepClass = "route" | "final_generation" | "tool";

export interface AuthorityReceiptClaims {
  version: typeof VERSION;
  purpose: ReceiptPurpose;
  /** Which authority minted this — e.g. "authority-pdp", "authority-cost", "authority-agent-run", "authority-scheduler". */
  issuer: string;
  receiptId: string;
  requestId: string;
  turnId?: string;
  stepId?: string;
  stepClass?: AgentStepClass;
  stepIndex?: number;
  modelRef?: string;
  artifactDigest?: `sha256:${string}`;
  capability?: string;
  reservationRef?: string;
  subEnvelope?: SubEnvelopeClass;
  subjectRef?: string;
  deviceRef?: string;
  sessionRef?: string;
  applicationRef?: string;
  workspaceRef?: string;
  purposeRef?: string;
  requestClass?: string;
  /** Digest of whatever request/turn/step content this receipt attests — bound at issuance, re-checked at every consumption. */
  boundDigest: `sha256:${string}`;
  /** The issuing authority's own policy/model/registry revision at issuance — a stale-revision replay is rejected by comparing this against the caller's expected revision, not just checking the signature. */
  revision: number;
  issuedAt: number;
  expiresAt: number;
}

export type AuthorityReceiptInput = Omit<AuthorityReceiptClaims, "version" | "receiptId" | "issuedAt" | "expiresAt">;

export interface SignedAuthorityReceipt {
  token: string;
  claims: AuthorityReceiptClaims;
}

export class AuthorityReceiptError extends Error {
  constructor(readonly code: "INVALID" | "EXPIRED" | "MISMATCH" | "SIGNATURE_INVALID", message: string) {
    super(message);
  }
}

function privateKeyFromPem(value: string | KeyObject): KeyObject {
  try {
    const key = typeof value === "string" ? createPrivateKey(value) : value;
    if (key.type !== "private" || key.asymmetricKeyType !== "ed25519") throw new Error("wrong key type");
    return key;
  } catch {
    throw new AuthorityReceiptError("INVALID", "Authority receipt signing key must be an Ed25519 private key.");
  }
}

function publicKeyFromPem(value: string | KeyObject): KeyObject {
  try {
    const key = typeof value === "string" ? createPublicKey(value) : value;
    if (key.type !== "public" || key.asymmetricKeyType !== "ed25519") throw new Error("wrong key type");
    return key;
  } catch {
    throw new AuthorityReceiptError("INVALID", "Authority receipt verification key must be an Ed25519 public key.");
  }
}

function signingBytes(claims: AuthorityReceiptClaims): Buffer {
  return Buffer.from(`${VERSION}.${canonicalJson(claims)}`, "utf8");
}

/** Issues signed receipts. Only a shared authority process should ever hold this. */
export class AuthorityReceiptIssuer {
  private readonly key: KeyObject;
  private readonly now: () => number;

  constructor(privateKey: string | KeyObject, options?: { now?: () => number }) {
    this.key = privateKeyFromPem(privateKey);
    this.now = options?.now ?? (() => Date.now());
  }

  issue(input: AuthorityReceiptInput, ttlMs: number): SignedAuthorityReceipt {
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_TTL_MS) {
      throw new AuthorityReceiptError("INVALID", "Authority receipt TTL must be between 1ms and 60000ms.");
    }
    const issuedAt = this.now();
    const claims: AuthorityReceiptClaims = { ...input, version: VERSION, receiptId: randomUUID(), issuedAt, expiresAt: issuedAt + ttlMs };
    const signature = cryptoSign(null, signingBytes(claims), this.key).toString("base64url");
    return { token: `${VERSION}.${Buffer.from(JSON.stringify(claims), "utf8").toString("base64url")}.${signature}`, claims };
  }
}

/** What a caller expects a receipt to attest, checked field by field — never just "signature valid". */
export type ExpectedAuthorityReceipt = Partial<AuthorityReceiptClaims> & { purpose: ReceiptPurpose; requestId: string };

export interface ReceiptVerifier {
  verify(token: string, expected: ExpectedAuthorityReceipt, signal?: AbortSignal): AuthorityReceiptClaims;
}

/** Real Ed25519 verification: signature, purpose, issuer-bound fields, and expiry. Callers must still claim `receiptId` in the shared replay store for one-use enforcement. */
export class Ed25519ReceiptVerifier implements ReceiptVerifier {
  private readonly key: KeyObject;
  private readonly now: () => number;

  constructor(publicKey: string | KeyObject, options?: { now?: () => number }) {
    this.key = publicKeyFromPem(publicKey);
    this.now = options?.now ?? (() => Date.now());
  }

  verify(token: string, expected: ExpectedAuthorityReceipt): AuthorityReceiptClaims {
    if (typeof token !== "string" || token.length === 0 || token.length > 8_192) {
      throw new AuthorityReceiptError("INVALID", "Authority receipt is malformed.");
    }
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== VERSION || !parts[1] || !parts[2]) {
      throw new AuthorityReceiptError("INVALID", "Authority receipt is malformed.");
    }
    let claims: unknown;
    try {
      claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    } catch {
      throw new AuthorityReceiptError("INVALID", "Authority receipt payload is not valid JSON.");
    }
    if (!claims || typeof claims !== "object" || Array.isArray(claims)) {
      throw new AuthorityReceiptError("INVALID", "Authority receipt payload is malformed.");
    }
    const record = claims as AuthorityReceiptClaims;
    if (record.version !== VERSION) throw new AuthorityReceiptError("INVALID", "Authority receipt version mismatch.");

    let signatureValid: boolean;
    try {
      signatureValid = cryptoVerify(null, signingBytes(record), this.key, Buffer.from(parts[2], "base64url"));
    } catch {
      signatureValid = false;
    }
    if (!signatureValid) throw new AuthorityReceiptError("SIGNATURE_INVALID", "Authority receipt signature is invalid.");

    const now = this.now();
    if (record.expiresAt <= now) throw new AuthorityReceiptError("EXPIRED", "Authority receipt has expired.");
    if (record.issuedAt > now + 1_000) throw new AuthorityReceiptError("INVALID", "Authority receipt was issued in the future.");

    for (const key of Object.keys(expected) as (keyof ExpectedAuthorityReceipt)[]) {
      if (expected[key] === undefined) continue;
      if (record[key] !== expected[key]) {
        throw new AuthorityReceiptError("MISMATCH", `Authority receipt field "${key}" does not match the caller's expectation.`);
      }
    }
    return record;
  }
}

/** Production default when no real verifier is wired: fails closed, never treats a bare string as evidence. */
export class FailClosedReceiptVerifier implements ReceiptVerifier {
  verify(): never {
    throw new AuthorityReceiptError("INVALID", "No authority receipt verifier is configured.");
  }
}
