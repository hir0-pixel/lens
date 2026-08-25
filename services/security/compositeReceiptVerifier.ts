import { Ed25519ReceiptVerifier, type AuthorityReceiptClaims, type ExpectedAuthorityReceipt, type ReceiptVerifier } from "./authorityReceipt";

/** Verifies receipts from multiple authorities; each service holds its own signing key. */
export class CompositeReceiptVerifier implements ReceiptVerifier {
  private readonly verifiers: readonly Ed25519ReceiptVerifier[];

  constructor(publicKeys: readonly (string | import("node:crypto").KeyObject)[], options?: { now?: () => number }) {
    if (publicKeys.length === 0) throw new Error("CompositeReceiptVerifier requires at least one verification public key.");
    this.verifiers = publicKeys.map((key) => new Ed25519ReceiptVerifier(key, options));
  }

  verify(token: string, expected: ExpectedAuthorityReceipt): AuthorityReceiptClaims {
    let last: unknown;
    for (const verifier of this.verifiers) {
      try {
        return verifier.verify(token, expected);
      } catch (error) {
        last = error;
      }
    }
    throw last instanceof Error ? last : new Error("Authority receipt verification failed.");
  }
}
