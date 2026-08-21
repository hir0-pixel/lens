import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { PendingFlow } from "./oidcClient";

const AAD = Buffer.from("lens:oidc-pending:v1", "utf8");
const MAX_STATE_LENGTH = 2_048;

interface SealedFlow {
  version: 1;
  verifier: string;
  nonce: string;
  expiresAt: number;
  browserBindingDigest: string;
}

function bindingDigest(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Encrypted OIDC state that remains usable across stateless BFF replicas. */
export function createStatelessPendingFlowCodec(secret: string, now: () => number = () => Date.now()) {
  if (secret.length < 32) throw new Error("OIDC state secret must contain at least 32 characters.");
  const key = createHash("sha256").update("lens:oidc-state\0").update(secret).digest();

  return {
    seal(flow: PendingFlow, browserBinding: string): PendingFlow {
      if (!browserBinding || flow.expiresAt <= now()) throw new Error("OIDC pending flow is invalid.");
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(AAD);
      const payload: SealedFlow = {
        version: 1,
        verifier: flow.verifier,
        nonce: flow.nonce,
        expiresAt: flow.expiresAt,
        browserBindingDigest: bindingDigest(browserBinding),
      };
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
      const state = Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString("base64url");
      if (state.length > MAX_STATE_LENGTH) throw new Error("OIDC pending state exceeded its byte envelope.");
      return { ...flow, state };
    },

    open(state: string | undefined, browserBinding: string | undefined): PendingFlow | undefined {
      try {
        if (!state || state.length > MAX_STATE_LENGTH || !browserBinding || browserBinding.length > 256) return undefined;
        const sealed = Buffer.from(state, "base64url");
        if (sealed.length < 29) return undefined;
        const decipher = createDecipheriv("aes-256-gcm", key, sealed.subarray(0, 12));
        decipher.setAAD(AAD);
        decipher.setAuthTag(sealed.subarray(12, 28));
        const decoded = JSON.parse(Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]).toString("utf8")) as Partial<SealedFlow>;
        if (
          decoded.version !== 1 ||
          typeof decoded.verifier !== "string" ||
          decoded.verifier.length < 43 ||
          decoded.verifier.length > 256 ||
          typeof decoded.nonce !== "string" ||
          decoded.nonce.length < 16 ||
          decoded.nonce.length > 256 ||
          typeof decoded.expiresAt !== "number" ||
          !Number.isSafeInteger(decoded.expiresAt) ||
          decoded.expiresAt <= now() ||
          typeof decoded.browserBindingDigest !== "string" ||
          !safeEqual(decoded.browserBindingDigest, bindingDigest(browserBinding))
        ) {
          return undefined;
        }
        return { verifier: decoded.verifier, nonce: decoded.nonce, expiresAt: decoded.expiresAt, state };
      } catch {
        return undefined;
      }
    },
  };
}
