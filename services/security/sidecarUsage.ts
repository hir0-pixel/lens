import { createPublicKey, verify } from "node:crypto";
import { canonicalJson } from "./canonicalJson";
import { USAGE_SCHEMA_VERSION } from "../inference-adapter/localMeter";

export interface SidecarUsagePayload {
  schemaVersion: number;
  reservationId: string;
  requestId: string;
  turnId: string;
  stepId: string;
  fence: number;
  artifactDigest: string;
  endpointGeneration: string;
  usageEventId: string;
  measuredUnits: number;
  terminal: "completed" | "cancelled" | "failed";
}

/** Orchestrator-owned dispatch identity. Never copied from the receipt under verification. */
export interface UsageExpectedContext {
  reservationId: string;
  requestId: string;
  turnId: string;
  stepId: string;
  fence: number;
  artifactDigest: string;
  endpointGeneration: string;
}

const claimedUsageEvents = new Set<string>();

export function resetUsageReplayGuardForTests(): void {
  claimedUsageEvents.clear();
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length < 4_096;
}

function payloadComplete(payload: SidecarUsagePayload): boolean {
  return payload.schemaVersion === USAGE_SCHEMA_VERSION
    && nonempty(payload.reservationId)
    && nonempty(payload.requestId)
    && nonempty(payload.turnId)
    && nonempty(payload.stepId)
    && nonempty(payload.artifactDigest)
    && nonempty(payload.endpointGeneration)
    && nonempty(payload.usageEventId)
    && Number.isSafeInteger(payload.fence) && payload.fence >= 1
    && Number.isSafeInteger(payload.measuredUnits) && payload.measuredUnits >= 0 && payload.measuredUnits <= 1_000_000
    && (payload.terminal === "completed" || payload.terminal === "cancelled" || payload.terminal === "failed");
}

function matchesExpected(payload: SidecarUsagePayload, expected: UsageExpectedContext): boolean {
  return payload.reservationId === expected.reservationId
    && payload.requestId === expected.requestId
    && payload.turnId === expected.turnId
    && payload.stepId === expected.stepId
    && payload.fence === expected.fence
    && payload.artifactDigest === expected.artifactDigest
    && payload.endpointGeneration === expected.endpointGeneration
    && nonempty(expected.reservationId)
    && nonempty(expected.requestId)
    && nonempty(expected.turnId)
    && nonempty(expected.stepId)
    && nonempty(expected.artifactDigest)
    && nonempty(expected.endpointGeneration)
    && Number.isSafeInteger(expected.fence) && expected.fence >= 1;
}

export function verifySidecarUsage(
  publicPem: string,
  payload: SidecarUsagePayload,
  signature: string,
  expected: UsageExpectedContext,
): boolean {
  if (!signature || !payloadComplete(payload) || !matchesExpected(payload, expected)) return false;
  try {
    return verify(null, Buffer.from(canonicalJson(payload), "utf8"), createPublicKey(publicPem), Buffer.from(signature, "base64url"));
  } catch {
    return false;
  }
}

/** Signature verification plus one-use usageEventId claim. Identical replay is rejected. */
export function claimVerifiedUsage(
  publicPem: string,
  payload: SidecarUsagePayload,
  signature: string,
  expected: UsageExpectedContext,
): boolean {
  if (!verifySidecarUsage(publicPem, payload, signature, expected)) return false;
  if (claimedUsageEvents.has(payload.usageEventId)) return false;
  claimedUsageEvents.add(payload.usageEventId);
  return true;
}

export function conservativeMeasuredUnits(reservedUnits: number, sidecarTokens: number | undefined, verified: boolean): number {
  if (!verified || sidecarTokens == null || sidecarTokens < 0) return reservedUnits;
  return Math.max(reservedUnits, sidecarTokens);
}
