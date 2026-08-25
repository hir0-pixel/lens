import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { OutputBlobRow } from "./store";

const ALGORITHM = "aes-256-gcm";
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;
const KEY_VERSION = "aes-256-gcm:v1";
const HEX_32_BYTE_KEY = /^[a-f0-9]{64}$/i;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export class OutputBlobConfigurationError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export class OutputBlobIntegrityError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export interface EncryptedOutputBlob {
  outputCiphertext: string;
  outputNonce: string;
  outputAuthTag: string;
  outputKeyVersion: string;
}

function associatedData(outputRef: string, outputDigest: string): Buffer {
  return Buffer.from(`${KEY_VERSION}|${outputRef}|${outputDigest}`, "utf8");
}

export class OutputBlobCrypto {
  readonly keyVersion = KEY_VERSION;
  private readonly key: Buffer;

  constructor(key: Buffer) {
    if (key.length !== KEY_BYTES) {
      throw new OutputBlobConfigurationError("Authority output encryption key must be exactly 32 bytes.");
    }
    this.key = Buffer.from(key);
  }

  static fromHex(value: unknown): OutputBlobCrypto {
    if (typeof value !== "string" || !HEX_32_BYTE_KEY.test(value)) {
      throw new OutputBlobConfigurationError("LENS_AUTHORITY_OUTPUT_KEY_HEX must be exactly 64 hexadecimal characters (32 bytes).");
    }
    return new OutputBlobCrypto(Buffer.from(value, "hex"));
  }

  encrypt(output: string, outputRef: string, outputDigest: string): EncryptedOutputBlob {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, nonce);
    cipher.setAAD(associatedData(outputRef, outputDigest));
    const ciphertext = Buffer.concat([cipher.update(output, "utf8"), cipher.final()]);
    return {
      outputCiphertext: ciphertext.toString("base64"),
      outputNonce: nonce.toString("base64"),
      outputAuthTag: cipher.getAuthTag().toString("base64"),
      outputKeyVersion: KEY_VERSION,
    };
  }

  decrypt(row: Pick<OutputBlobRow, "outputRef" | "outputDigest" | "outputCiphertext" | "outputNonce" | "outputAuthTag" | "outputKeyVersion">): string {
    if (row.outputKeyVersion !== KEY_VERSION) {
      throw new OutputBlobIntegrityError("Unsupported output encryption key version.");
    }
    if (!BASE64.test(row.outputCiphertext) || !BASE64.test(row.outputNonce) || !BASE64.test(row.outputAuthTag)) {
      throw new OutputBlobIntegrityError("Encrypted output envelope is not valid base64.");
    }
    const nonce = Buffer.from(row.outputNonce, "base64");
    const authTag = Buffer.from(row.outputAuthTag, "base64");
    if (nonce.length !== NONCE_BYTES || authTag.length !== AUTH_TAG_BYTES) {
      throw new OutputBlobIntegrityError("Encrypted output envelope has invalid nonce or authentication tag length.");
    }
    try {
      const decipher = createDecipheriv(ALGORITHM, this.key, nonce);
      decipher.setAAD(associatedData(row.outputRef, row.outputDigest));
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(Buffer.from(row.outputCiphertext, "base64")), decipher.final()]).toString("utf8");
    } catch {
      throw new OutputBlobIntegrityError("Encrypted output failed authenticated decryption.");
    }
  }
}
