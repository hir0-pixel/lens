import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

const MAX_SESSION_COOKIE_LENGTH = 3800;

export function base64url(bytes: Uint8Array | Buffer): string {
  return Buffer.from(bytes).toString("base64url");
}

export function randomBase64Url(size = 32): string {
  return base64url(randomBytes(size));
}

export function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

export function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export interface SealedSession {
  version: 1;
  sid: string;
  subjectRef: string;
  csrfToken: string;
  accessToken: string;
  refreshToken: string;
  idToken: string;
  tokenExpiresAt: number;
  expiresAt: number;
  profile: {
    name?: string;
    email?: string;
    picture?: string;
    preferredUsername?: string;
  };
}

export function createSealedSessionCodec(secret: string, random: typeof randomBytes = randomBytes) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("Session cookie secret must be at least 32 characters");
  }
  const key = createHash("sha256").update(secret).digest();
  return {
    seal(value: SealedSession): string {
      const nonce = random(12);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      const encrypted = Buffer.concat([
        cipher.update(JSON.stringify(value), "utf8"),
        cipher.final(),
      ]);
      const sealed = base64url(Buffer.concat([nonce, cipher.getAuthTag(), encrypted]));
      if (sealed.length > MAX_SESSION_COOKIE_LENGTH) {
        throw new Error("Session payload exceeds the cookie limit");
      }
      return sealed;
    },
    open(value: string | undefined): SealedSession | undefined {
      try {
        if (typeof value !== "string" || value.length === 0 || value.length > 4096) {
          return undefined;
        }
        const payload = Buffer.from(value, "base64url");
        if (payload.length < 29) return undefined;
        const decipher = createDecipheriv("aes-256-gcm", key, payload.subarray(0, 12));
        decipher.setAuthTag(payload.subarray(12, 28));
        const decoded = JSON.parse(
          Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString("utf8"),
        );
        if (
          decoded &&
          typeof decoded === "object" &&
          decoded.version === 1 &&
          typeof decoded.sid === "string" &&
          typeof decoded.subjectRef === "string" &&
          typeof decoded.csrfToken === "string" &&
          typeof decoded.accessToken === "string" &&
          typeof decoded.refreshToken === "string" &&
          typeof decoded.tokenExpiresAt === "number" &&
          typeof decoded.expiresAt === "number"
        ) {
          return decoded as SealedSession;
        }
        return undefined;
      } catch {
        return undefined;
      }
    },
  };
}
