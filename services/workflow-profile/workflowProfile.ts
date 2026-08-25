import { createHash } from "node:crypto";
import { canonicalJson } from "../security/canonicalJson";
import type { SubEnvelopeClass } from "../cost-authority/CostAuthority";

export interface WorkflowLimits {
  route: { maximumUnits: number };
  retrieval: { maximumUnits: number };
  final_generation: { maximumUnits: number };
  tool: { maximumUnits: number };
}

/** Policy-owned bounded estimates when a signed route-policy entry does not override them. */
export const DEFAULT_WORKFLOW_LIMITS: WorkflowLimits = {
  route: { maximumUnits: 4_096 },
  retrieval: { maximumUnits: 100 },
  final_generation: { maximumUnits: 8_192 },
  tool: { maximumUnits: 4 },
};

export const ALLOWED_AGENT_STEP_CLASSES = ["route", "final_generation", "tool"] as const;

export interface SignedWorkflowProfile {
  applicationRef: string;
  workspaceRef: string;
  purposeRef: string;
  requestClass: string;
  deadlineAt: number;
  reservationRef: string;
  routePolicyRevision: number;
  routePolicyDigest: `sha256:${string}`;
  allowedProfileSetDigest: `sha256:${string}`;
  allowedStepClasses: readonly typeof ALLOWED_AGENT_STEP_CLASSES[number][];
  limits: WorkflowLimits;
}

export function workflowProfileDigest(profile: SignedWorkflowProfile): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalJson(profile), "utf8").digest("hex")}`;
}

export function resolveWorkflowLimits(entry?: { workflowLimits?: Partial<Record<SubEnvelopeClass, { maximumUnits: number }>> }): WorkflowLimits {
  const merged: WorkflowLimits = {
    route: { maximumUnits: entry?.workflowLimits?.route?.maximumUnits ?? DEFAULT_WORKFLOW_LIMITS.route.maximumUnits },
    retrieval: { maximumUnits: entry?.workflowLimits?.retrieval?.maximumUnits ?? DEFAULT_WORKFLOW_LIMITS.retrieval.maximumUnits },
    final_generation: { maximumUnits: entry?.workflowLimits?.final_generation?.maximumUnits ?? DEFAULT_WORKFLOW_LIMITS.final_generation.maximumUnits },
    tool: { maximumUnits: entry?.workflowLimits?.tool?.maximumUnits ?? DEFAULT_WORKFLOW_LIMITS.tool.maximumUnits },
  };
  for (const key of Object.keys(merged) as (keyof WorkflowLimits)[]) {
    if (!Number.isFinite(merged[key].maximumUnits) || merged[key].maximumUnits < 1 || merged[key].maximumUnits > 1_000_000) {
      throw new Error(`Workflow limit for ${key} is out of bounded range.`);
    }
  }
  return merged;
}

export function estimateModelUnits(textBytes: number, cap: number): number {
  const tokens = Math.max(1, Math.ceil(textBytes / 4));
  return Math.min(cap, tokens);
}
