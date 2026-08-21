import { createHmac } from "node:crypto";

export const GOVERNED_REFERENCE_SCOPES = [
  "request",
  "turn",
  "retrieval",
  "decision",
  "index-generation",
  "trace",
  "span",
  "workload",
] as const;

export type GovernedReferenceScope = (typeof GOVERNED_REFERENCE_SCOPES)[number];

export interface GovernedReferenceKey {
  keyId: string;
  secret: Uint8Array | string;
}

const KEY_ID = /^[a-z0-9][a-z0-9_.-]{0,31}$/i;
const GOVERNED_REFERENCE = /^gref:v1:[a-z0-9][a-z0-9_.-]{0,31}:(request|turn|retrieval|decision|index-generation|trace|span|workload):[A-Za-z0-9_-]{43}$/;

function keyBytes(secret: Uint8Array | string): Uint8Array {
  return typeof secret === "string" ? new TextEncoder().encode(secret) : secret;
}

/** Creates a stable, non-reversible correlation reference under a scoped rotating key. */
export function createGovernedReference(
  rawIdentifier: string,
  scope: GovernedReferenceScope,
  key: GovernedReferenceKey,
): string {
  if (!rawIdentifier || rawIdentifier.length > 4_096) {
    throw new Error("Correlation source must be between 1 and 4096 characters");
  }
  if (!KEY_ID.test(key.keyId)) {
    throw new Error("Correlation key ID must be a bounded safe token");
  }
  const secret = keyBytes(key.secret);
  if (secret.byteLength < 32) {
    throw new Error("Correlation HMAC keys must contain at least 256 bits");
  }
  const digest = createHmac("sha256", secret)
    .update("lens-observability-gref-v1\0")
    .update(scope)
    .update("\0")
    .update(rawIdentifier)
    .digest("base64url");
  return `gref:v1:${key.keyId}:${scope}:${digest}`;
}

export function isGovernedReference(value: string, scope?: GovernedReferenceScope): boolean {
  if (!GOVERNED_REFERENCE.test(value)) {
    return false;
  }
  return scope === undefined || value.split(":", 5)[3] === scope;
}
