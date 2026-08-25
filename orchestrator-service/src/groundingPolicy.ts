/**
 * Signed, server-owned route policy (Doc 004 §23 / Doc 004 item 16 of the
 * 2026-08-22 runtime-adapter/adaptive-RAG reconciliation). Resolved ONCE per
 * turn from application/workspace/purpose/request-class alone — never from
 * router output, never from user/request content — and consulted BEFORE the
 * router runs. The router's own classification can never weaken what this
 * policy requires; see router.ts's `enforceGroundingRequirement`.
 */
import { createHash, createHmac, createPrivateKey, createPublicKey, sign as cryptoSign, verify as cryptoVerify, timingSafeEqual, type KeyObject } from "node:crypto";
import { canonicalJson } from "../../services/security/canonicalJson";

function entryDigest(entry: RoutePolicyManifestEntry): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalJson(entry), "utf8").digest("hex")}`;
}

function selectorSetDigest(selectors: readonly string[]): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(selectors.slice().sort().join("|"), "utf8").digest("hex")}`;
}

function timingSafeHexEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  return bufA.length === bufB.length && bufA.length > 0 && timingSafeEqual(bufA, bufB);
}

export type NoDefaultSelectorBehavior = "FAIL_CLOSED" | "CLARIFY";

export interface RoutePolicyInput {
  requestId: string;
  subjectRef: string;
  applicationRef: string;
  workspaceRef: string;
  purposeRef: string;
  /** A trusted, server-derived classification of this request (e.g. retrieval_class) — never client-supplied free text. */
  requestClass: string;
}

export interface RoutePolicyResult {
  applicationRef: string;
  workspaceRef: string;
  purposeRef: string;
  requestClass: string;
  routePolicyRevision: number;
  routePolicyDigest: `sha256:${string}`;
  groundingRequired: boolean;
  /** The exact platform-owned router model reference. Never the employee-selected model_ref. */
  routerModelRef: string;
  allowedProfileSelectors: readonly string[];
  allowedProfileSetDigest: `sha256:${string}`;
  /** The pre-scoped set's designated default selector for this scope, if the policy defines one. */
  defaultProfileSelector?: string;
  /** What the signed policy revision specifies when no default selector exists for this scope and grounding must be enforced anyway. */
  noDefaultSelectorBehavior: NoDefaultSelectorBehavior;
  /** Bounded, policy-owned clarification text for this scope. CLARIFY never uses router prose (Doc 004 §11) — this is the only text a CLARIFY route may surface. */
  clarificationText: string;
  workflowLimits?: Partial<Record<"route" | "retrieval" | "final_generation" | "tool", { maximumUnits: number }>>;
}

export type RoutePolicyFailureCode =
  | "POLICY_UNAVAILABLE"
  | "POLICY_EXPIRED"
  | "POLICY_INVALID_SIGNATURE"
  | "POLICY_NOT_FOUND"
  /** Reload only: the offered manifest's revision is <= the currently-live manifest's revision (rollback or a duplicate/replay) — rejected, the previously-verified manifest stays in effect. */
  | "POLICY_ROLLBACK_REJECTED";

export class RoutePolicyError extends Error {
  constructor(readonly code: RoutePolicyFailureCode) {
    super(code);
  }
}

/** Signed, server-owned policy resolved from application/workspace/purpose/request-class — never from client input, never from the router's own output. */
export interface RoutePolicyPort {
  resolve(input: RoutePolicyInput, signal: AbortSignal): Promise<RoutePolicyResult>;
}

/**
 * Production default. Denies every resolution. A production deployment MUST
 * inject a real, signed RoutePolicyPort (backed by the PDP/route-policy
 * authority) via `orchestrator-service/src/main.ts` — there is no
 * permissive/always-allow default anywhere on the production-reachable path.
 * If the signed policy authority is absent, invalid, expired, or
 * unreachable, this is what production falls back to: a hard deny, not a
 * silent "grounding not required."
 */
export class FailClosedRoutePolicyPort implements RoutePolicyPort {
  async resolve(_input: RoutePolicyInput, _signal: AbortSignal): Promise<RoutePolicyResult> {
    throw new RoutePolicyError("POLICY_UNAVAILABLE");
  }
}

/**
 * DEV/TEST ONLY. Explicitly named so it can never be mistaken for a
 * production default and never grep-matches a "Permissive"/production-looking
 * name. Returns a fixed, static policy revision — no signature verification,
 * no expiry enforcement, no live authority. Never wired by
 * `orchestrator-service/src/main.ts`'s production path; tests and local
 * development construct it explicitly.
 */
/**
 * A single entry in a signed route-policy manifest, scoped to exactly one
 * (application, workspace, purpose, request-class) combination. Everything
 * downstream (grounding_required, the router model, the allowed retrieval
 * profile selectors, the default selector, and the CLARIFY-vs-fail-closed
 * choice when no default exists) is resolved from this scope alone.
 */
export interface RoutePolicyManifestEntry {
  applicationRef: string;
  workspaceRef: string;
  purposeRef: string;
  requestClass: string;
  routePolicyRevision: number;
  groundingRequired: boolean;
  routerModelRef: string;
  allowedProfileSelectors: readonly string[];
  defaultProfileSelector?: string;
  noDefaultSelectorBehavior: NoDefaultSelectorBehavior;
  clarificationText: string;
  /** Policy-owned bounded Cost estimates for the four non-interchangeable sub-envelopes. */
  workflowLimits?: Partial<Record<"route" | "retrieval" | "final_generation" | "tool", { maximumUnits: number }>>;
  /** Unix ms. Entries past this are never resolved, even if the manifest signature itself is still valid. */
  expiresAt: number;
}

export interface RoutePolicyManifest {
  /** Monotonic across the whole manifest (distinct from each entry's own per-scope routePolicyRevision) — the unit hot-reload compares to reject rollback/duplicate/replay. */
  manifestRevision: number;
  entries: readonly RoutePolicyManifestEntry[];
}

/** Verify-only capability. This is deliberately the narrowest interface `SignedRoutePolicyManifestPort` depends on: the Orchestrator process only ever needs to CHECK a signature, never produce one — see `RoutePolicyManifestSigner` below for the ops-tooling-only signing capability. */
export interface RoutePolicyManifestVerifier {
  verify(manifest: RoutePolicyManifest, signature: string): boolean;
}

/** Verifies and signs route-policy manifests. Mirrors the HmacChangeGate/signChangeFence pattern already used for model-registry changes (see modelGovernance.ts) — same trust model, same ops-key custody expectations. Ops tooling only — production `main.ts` never constructs one of these, only a `RoutePolicyManifestVerifier`. */
export interface RoutePolicyManifestSigner extends RoutePolicyManifestVerifier {
  sign(manifest: RoutePolicyManifest): string;
}

/**
 * Production route-policy authority: a signed, versioned manifest verified
 * at construction and re-verified on every `reload()` call (never silently
 * trusted from disk without signature verification). Fails closed —
 * throwing RoutePolicyError, never returning a permissive default — on: an
 * invalid/missing signature, every entry expired, no entry matching the
 * exact (application, workspace, purpose, request-class) scope, or (reload
 * only) a manifest whose revision does not strictly advance past the
 * currently-live one (rollback, duplicate, or replay).
 *
 * This is deliberately a static, versioned manifest rather than a live
 * network call — a route-policy resolution never depends on a separate
 * service being reachable mid-request. Rotating the manifest is a bounded,
 * in-process operation (`reload()`), not a restart: `main.ts` wires it to
 * SIGHUP against a manifest/signature file pair (item 7), preferring an
 * asymmetric `RoutePolicyManifestVerifier` (this class holds only a
 * verification capability — never a signing key) over the legacy
 * `HmacRoutePolicyManifestSigner`.
 */
export class SignedRoutePolicyManifestPort implements RoutePolicyPort {
  private entries: readonly RoutePolicyManifestEntry[];
  private manifestRevision: number;

  constructor(manifest: RoutePolicyManifest, signature: string, private readonly verifier: RoutePolicyManifestVerifier) {
    const verified = SignedRoutePolicyManifestPort.verifyManifest(manifest, signature, verifier);
    this.entries = verified.entries;
    this.manifestRevision = verified.manifestRevision;
  }

  private static verifyManifest(manifest: RoutePolicyManifest, signature: string, verifier: RoutePolicyManifestVerifier): { entries: readonly RoutePolicyManifestEntry[]; manifestRevision: number } {
    if (!verifier.verify(manifest, signature)) {
      throw new RoutePolicyError("POLICY_INVALID_SIGNATURE");
    }
    if (manifest.entries.length === 0) {
      throw new RoutePolicyError("POLICY_UNAVAILABLE");
    }
    if (!Number.isSafeInteger(manifest.manifestRevision) || manifest.manifestRevision < 1) {
      throw new RoutePolicyError("POLICY_INVALID_SIGNATURE");
    }
    return { entries: manifest.entries, manifestRevision: manifest.manifestRevision };
  }

  /**
   * Bounded hot-reload: verifies the new manifest exactly like construction
   * does, PLUS rejects rollback/duplicate/replay (manifestRevision must
   * strictly exceed the currently-live one) and rejects a manifest with no
   * live (unexpired) entries at all. On any rejection the currently-live
   * manifest is left untouched — a bad reload attempt degrades nothing.
   */
  reload(manifest: RoutePolicyManifest, signature: string): void {
    const verified = SignedRoutePolicyManifestPort.verifyManifest(manifest, signature, this.verifier);
    if (verified.manifestRevision <= this.manifestRevision) {
      throw new RoutePolicyError("POLICY_ROLLBACK_REJECTED");
    }
    if (!verified.entries.some((entry) => entry.expiresAt > Date.now())) {
      throw new RoutePolicyError("POLICY_EXPIRED");
    }
    this.entries = verified.entries;
    this.manifestRevision = verified.manifestRevision;
  }

  currentManifestRevision(): number {
    return this.manifestRevision;
  }

  async resolve(input: RoutePolicyInput, _signal?: AbortSignal): Promise<RoutePolicyResult> {
    const entry = this.entries.find((candidate) =>
      candidate.applicationRef === input.applicationRef &&
      candidate.workspaceRef === input.workspaceRef &&
      candidate.purposeRef === input.purposeRef &&
      candidate.requestClass === input.requestClass,
    );
    if (!entry) throw new RoutePolicyError("POLICY_NOT_FOUND");
    if (entry.expiresAt <= Date.now()) throw new RoutePolicyError("POLICY_EXPIRED");
    return {
      applicationRef: entry.applicationRef,
      workspaceRef: entry.workspaceRef,
      purposeRef: entry.purposeRef,
      requestClass: entry.requestClass,
      routePolicyRevision: entry.routePolicyRevision,
      routePolicyDigest: entryDigest(entry),
      groundingRequired: entry.groundingRequired,
      routerModelRef: entry.routerModelRef,
      allowedProfileSelectors: entry.allowedProfileSelectors,
      allowedProfileSetDigest: selectorSetDigest(entry.allowedProfileSelectors),
      defaultProfileSelector: entry.defaultProfileSelector,
      noDefaultSelectorBehavior: entry.noDefaultSelectorBehavior,
      clarificationText: entry.clarificationText,
      workflowLimits: entry.workflowLimits,
    };
  }

  /** For readiness probes: false once every manifest entry has expired, meaning every future resolve() would deny with POLICY_EXPIRED. */
  hasLiveEntries(now: number = Date.now()): boolean {
    return this.entries.some((entry) => entry.expiresAt > now);
  }

  /** For startup/readiness enumeration of every `router_model_ref` a live scope could resolve (item 6 — Registry eligibility must be checked for all of them, not just the one a given request happens to hit). */
  liveEntries(now: number = Date.now()): readonly RoutePolicyManifestEntry[] {
    return this.entries.filter((entry) => entry.expiresAt > now);
  }
}

export class HmacRoutePolicyManifestSigner implements RoutePolicyManifestSigner {
  constructor(private readonly key: Buffer) {
    if (key.length < 32) throw new Error("HmacRoutePolicyManifestSigner key must be at least 32 bytes.");
  }

  sign(manifest: RoutePolicyManifest): string {
    return createHmac("sha256", this.key).update(canonicalJson(manifest)).digest("hex");
  }

  verify(manifest: RoutePolicyManifest, signature: string): boolean {
    let expected: string;
    try {
      expected = this.sign(manifest);
    } catch {
      return false;
    }
    return timingSafeHexEqual(signature, expected);
  }
}

export function signRoutePolicyManifest(opsKeyHex: string, manifest: RoutePolicyManifest): string {
  return new HmacRoutePolicyManifestSigner(Buffer.from(opsKeyHex, "hex")).sign(manifest);
}

function ed25519PrivateKeyFromPem(value: string | KeyObject): KeyObject {
  try {
    const key = typeof value === "string" ? createPrivateKey(value) : value;
    if (key.type !== "private" || key.asymmetricKeyType !== "ed25519") throw new Error("wrong key type");
    return key;
  } catch {
    throw new Error("Route-policy manifest signing key must be an Ed25519 private key.");
  }
}

function ed25519PublicKeyFromPem(value: string | KeyObject): KeyObject {
  try {
    const key = typeof value === "string" ? createPublicKey(value) : value;
    if (key.type !== "public" || key.asymmetricKeyType !== "ed25519") throw new Error("wrong key type");
    return key;
  } catch {
    throw new Error("Route-policy manifest verification key must be an Ed25519 public key.");
  }
}

/**
 * Production-preferred verifier (item 7): holds only an Ed25519 PUBLIC key.
 * There is no key material here capable of producing a valid signature —
 * unlike `HmacRoutePolicyManifestSigner`, whose symmetric key can both sign
 * and verify, so any process holding it (including the Orchestrator itself,
 * under the legacy HMAC path) could mint policy it merely needs to check.
 */
export class Ed25519RoutePolicyManifestVerifier implements RoutePolicyManifestVerifier {
  private readonly key: KeyObject;
  constructor(publicKey: string | KeyObject) {
    this.key = ed25519PublicKeyFromPem(publicKey);
  }
  verify(manifest: RoutePolicyManifest, signature: string): boolean {
    let signatureBuf: Buffer;
    try {
      signatureBuf = Buffer.from(signature, "hex");
    } catch {
      return false;
    }
    if (signatureBuf.length === 0) return false;
    try {
      return cryptoVerify(null, Buffer.from(canonicalJson(manifest), "utf8"), this.key, signatureBuf);
    } catch {
      return false;
    }
  }
}

/** Ops-tooling-only: mints Ed25519 signatures over a route-policy manifest. Never constructed by `main.ts`'s production path — only `Ed25519RoutePolicyManifestVerifier` (public key) is. */
export class Ed25519RoutePolicyManifestSigner implements RoutePolicyManifestSigner {
  private readonly key: KeyObject;
  constructor(privateKey: string | KeyObject) {
    this.key = ed25519PrivateKeyFromPem(privateKey);
  }
  sign(manifest: RoutePolicyManifest): string {
    return cryptoSign(null, Buffer.from(canonicalJson(manifest), "utf8"), this.key).toString("hex");
  }
  verify(manifest: RoutePolicyManifest, signature: string): boolean {
    return new Ed25519RoutePolicyManifestVerifier(createPublicKey(this.key)).verify(manifest, signature);
  }
}

export function signRoutePolicyManifestEd25519(privateKeyPem: string, manifest: RoutePolicyManifest): string {
  return new Ed25519RoutePolicyManifestSigner(privateKeyPem).sign(manifest);
}

export class DevRoutePolicyPort implements RoutePolicyPort {
  constructor(private readonly overrides: Partial<RoutePolicyResult> = {}) {}

  async resolve(input: RoutePolicyInput, _signal?: AbortSignal): Promise<RoutePolicyResult> {
    return {
      applicationRef: input.applicationRef,
      workspaceRef: input.workspaceRef,
      purposeRef: input.purposeRef,
      requestClass: input.requestClass,
      routePolicyRevision: 1,
      routePolicyDigest: `sha256:${"0".repeat(64)}`,
      groundingRequired: false,
      routerModelRef: "router-dev-default",
      allowedProfileSelectors: ["default"],
      allowedProfileSetDigest: `sha256:${"1".repeat(64)}`,
      defaultProfileSelector: "default",
      noDefaultSelectorBehavior: "CLARIFY",
      clarificationText: "Could you say more about what you'd like to know?",
      ...this.overrides,
    };
  }
}
