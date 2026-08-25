import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const VERSION = "c1";
const NONCE_BYTES = 32;
const MAC_BYTES = 32;
const MAX_REFERENCE_LENGTH = 256;
const MAX_SUBJECT_LENGTH = 512;
const MAX_CREATION_KEY_LENGTH = 128;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ConversationReferenceError extends Error {}

function assertSubject(subjectRef: unknown): asserts subjectRef is string {
  if (typeof subjectRef !== "string" || subjectRef.length === 0 || subjectRef.length > MAX_SUBJECT_LENGTH) {
    throw new ConversationReferenceError("subject_ref is invalid.");
  }
}

function keyFromSecret(secret: string): Buffer {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new ConversationReferenceError("Conversation reference secret must contain at least 32 characters.");
  }
  return Buffer.from(secret, "utf8");
}

function mac(key: Buffer, subjectRef: string, nonce: string, domain: string): Buffer {
  return createHmac("sha256", key).update(`${domain}|${VERSION}|${subjectRef}|${nonce}`, "utf8").digest();
}

function decodeCanonical(value: unknown, field: string): Buffer {
  if (typeof value !== "string" || value.length === 0 || !BASE64URL_RE.test(value)) {
    throw new ConversationReferenceError(`${field} encoding is invalid.`);
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length === 0 || decoded.toString("base64url") !== value) {
    throw new ConversationReferenceError(`${field} encoding is not canonical.`);
  }
  return decoded;
}

export class ConversationReferenceCodec {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = keyFromSecret(secret);
  }

  issue(subjectRef: string, creationKey?: string): string {
    assertSubject(subjectRef);
    let nonce: string;
    if (creationKey === undefined) {
      nonce = randomBytes(NONCE_BYTES).toString("base64url");
    } else {
      if (typeof creationKey !== "string" || creationKey.length === 0 || creationKey.length > MAX_CREATION_KEY_LENGTH || (!UUID_RE.test(creationKey) && !BASE64URL_RE.test(creationKey))) {
        throw new ConversationReferenceError("conversation_creation_key is invalid.");
      }
      if (!UUID_RE.test(creationKey)) {
        const keyBytes = decodeCanonical(creationKey, "conversation_creation_key");
        if (keyBytes.length !== NONCE_BYTES) throw new ConversationReferenceError("conversation_creation_key is invalid.");
      }
      nonce = createHmac("sha256", this.key).update(`lens-conversation-create-v1|${subjectRef}|${creationKey}`, "utf8").digest().subarray(0, NONCE_BYTES).toString("base64url");
    }
    return `${VERSION}.${nonce}.${mac(this.key, subjectRef, nonce, "lens-conversation-ref-v1").toString("base64url")}`;
  }

  verify(reference: string, subjectRef: string): void {
    assertSubject(subjectRef);
    if (typeof reference !== "string" || reference.length === 0 || reference.length > MAX_REFERENCE_LENGTH) {
      throw new ConversationReferenceError("conversation_ref is invalid.");
    }
    const parts = reference.split(".");
    if (parts.length !== 3 || parts[0] !== VERSION || !parts[1] || !parts[2]) {
      throw new ConversationReferenceError("conversation_ref is invalid.");
    }
    const nonce = decodeCanonical(parts[1], "nonce");
    const actualMac = decodeCanonical(parts[2], "mac");
    if (nonce.length !== NONCE_BYTES || actualMac.length !== MAC_BYTES) {
      throw new ConversationReferenceError("conversation_ref is invalid.");
    }
    const expectedMac = mac(this.key, subjectRef, parts[1], "lens-conversation-ref-v1");
    if (!timingSafeEqual(actualMac, expectedMac)) {
      throw new ConversationReferenceError("conversation_ref is not owned by the authenticated subject.");
    }
  }
}
