import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "../security/canonicalJson";

// Anchored to this module, not process.cwd(): services run from their own package directories.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export type McpEgressClass = "none" | "internal" | "external-approved";

export interface McpDataFlowProfile {
  egressClass: McpEgressClass;
  targets: readonly string[];
}

export interface ApprovedEgressPolicy {
  allowedDestinations: readonly string[];
}

const EGRESS_CLASSES = new Set<McpEgressClass>(["none", "internal", "external-approved"]);

export function validateDataFlowProfile(profile: unknown): profile is McpDataFlowProfile {
  if (!profile || typeof profile !== "object") return false;
  const candidate = profile as McpDataFlowProfile;
  if (!EGRESS_CLASSES.has(candidate.egressClass)) return false;
  if (!Array.isArray(candidate.targets)) return false;
  return candidate.targets.every((target) => typeof target === "string" && target.length > 0 && target.length <= 512);
}

function canonicalDataFlowProfile(profile: McpDataFlowProfile): { egressClass: McpEgressClass; targets: string[] } {
  return {
    egressClass: profile.egressClass,
    targets: [...profile.targets].sort(),
  };
}

/** `sha256(canonicalJson({ egressClass, targets: sorted }))` — same canonicalizer as schemaDigest. */
export function computeDataFlowProfileDigest(profile: McpDataFlowProfile): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalJson(canonicalDataFlowProfile(profile))).digest("hex")}`;
}

export function parseApprovedEgressPolicy(raw: unknown): ApprovedEgressPolicy {
  if (!raw || typeof raw !== "object") throw new Error("Approved egress policy is invalid.");
  const policyRoot = raw as { policy?: { allowedDestinations?: unknown } };
  const destinations = policyRoot.policy?.allowedDestinations;
  if (!Array.isArray(destinations) || !destinations.every((entry) => typeof entry === "string" && entry.length > 0)) {
    throw new Error("Approved egress policy allowedDestinations is invalid.");
  }
  return { allowedDestinations: destinations };
}

export function loadApprovedEgressPolicy(configPath?: string): ApprovedEgressPolicy {
  const path = configPath ?? join(REPO_ROOT, "platform/build/approved-egress.json");
  return parseApprovedEgressPolicy(JSON.parse(readFileSync(path, "utf8")));
}

export function isServerApprovedForExternalEgress(
  serverEndpoint: string,
  policy: ApprovedEgressPolicy,
): boolean {
  let hostname: string;
  try {
    hostname = new URL(serverEndpoint).hostname;
  } catch {
    return false;
  }
  return policy.allowedDestinations.includes(hostname);
}
