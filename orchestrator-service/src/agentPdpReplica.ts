import { AuditLedger } from "../../services/audit/AuditLedger";
import {
  PolicyDecisionPoint,
  type DecisionFenceSigner,
  type FactReaders,
  type PolicyBundle,
} from "../../services/pdp/PolicyDecisionPoint";

export const AGENT_PDP_WORKLOAD_ID = "orchestrator-agent-pdp";
export const AGENT_HARNESS_WORKLOAD_ID = "orchestrator-agent-harness";

const AGENT_AUDIT_EVENTS = [
  "agent.context.context_filtered",
  "agent.tool.decision_requested",
  "agent.tool.fence_consumed",
  "agent.tool.tool_blocked",
  "agent.tool.tool_completed",
] as const;

export interface AgentPolicyReplicaInput {
  factReaders: FactReaders;
  policyBundle: PolicyBundle;
  signer: DecisionFenceSigner;
  auditLedger: AuditLedger;
  now?: () => number;
}

export interface AgentPolicyReplica {
  pdp: PolicyDecisionPoint;
  auditLedger: AuditLedger;
  policyDigest?: string;
}

export function createAgentAuditLedger(now: () => Date = () => new Date()): AuditLedger {
  return new AuditLedger({
    [AGENT_PDP_WORKLOAD_ID]: ["pdp.decision"],
    [AGENT_HARNESS_WORKLOAD_ID]: AGENT_AUDIT_EVENTS,
  }, now);
}

export function createAgentPolicyReplica(input: AgentPolicyReplicaInput): AgentPolicyReplica {
  const pdp = new PolicyDecisionPoint(
    input.factReaders,
    {
      admitDecision(decision) {
        const receipt = input.auditLedger.appendIntent(
          { workloadId: AGENT_PDP_WORKLOAD_ID, attested: true },
          {
            eventId: decision.decisionId,
            partitionKey: decision.requestId,
            eventType: "pdp.decision",
            requestId: decision.requestId,
            action: decision.action,
            intentDigest: decision.candidateDigest,
            byteLength: decision.allowedDigest.length + decision.revisionDigest.length,
          },
        );
        return { receiptDigest: receipt.receiptDigest };
      },
    },
    input.signer,
    input.now,
  );
  pdp.activate(input.policyBundle, {
    independent: true,
    auditAdmitted: true,
    compatibilityPassed: true,
  });
  return { pdp, auditLedger: input.auditLedger, policyDigest: input.policyBundle.digest };
}

const MCP_TOOL_REF_PATTERN = /^tool:(.+)@([^@]+)$/;

/** Reports whether a subject holds the grant to use one MCP tool. Approval/drift state is
 * already enforced upstream, at the `resolveIntent` dispatch table in `agentHarness.ts` — an
 * unapproved or drifted tool never reaches the PDP at all (`resolveIntent` throws first). This
 * port answers the narrower, subject-specific question the M1 fence and M4's re-check both ask
 * independently: "does this subject hold the grant for this already-approved tool?" */
export interface McpToolGrantReader {
  (input: { subjectRef: string; toolId: string; version: string }): boolean;
}

/**
 * Wraps a base `FactReaders` so `resources()` also resolves `tool:<toolId>@<version>` refs
 * (M6 spec §M6b "Ships": "`FactReaders.resources` ... resolves `tool:` refs: published,
 * integrity-valid, `aclAllows` iff the subject holds the grant"). Every other ref is delegated to
 * `base` untouched, in its original position — `PolicyDecisionPoint.decideBatch` asserts the
 * returned facts are in the same order as the requested refs.
 *
 * `resources(refs)` alone is never given the subjectRef — only `subject(subjectRef)` is. Since
 * `decideBatch` always calls `subject()` immediately before `resources()`, and both calls happen
 * synchronously within one `decideBatch` invocation with no `await` between them, capturing the
 * most recently queried subjectRef in a closure variable is safe: no other `decideBatch` call can
 * interleave between the two reads of a single invocation.
 */
export function withMcpToolResourceFacts(base: FactReaders, hasGrant: McpToolGrantReader): FactReaders {
  let currentSubjectRef: string | undefined;
  return {
    ...base,
    subject(subjectRef) {
      currentSubjectRef = subjectRef;
      return base.subject(subjectRef);
    },
    resources(refs) {
      const nonToolRefs = refs.filter((ref) => !MCP_TOOL_REF_PATTERN.test(ref));
      const nonToolFacts = new Map(
        (nonToolRefs.length > 0 ? base.resources(nonToolRefs) : []).map((fact) => [fact.resourceRef, fact] as const),
      );
      const subjectRef = currentSubjectRef;
      return refs.map((ref) => {
        const match = MCP_TOOL_REF_PATTERN.exec(ref);
        if (!match) {
          const fact = nonToolFacts.get(ref);
          if (!fact) throw new Error("Resource facts missing for a non-tool ref.");
          return fact;
        }
        const [, toolId, version] = match;
        const granted = subjectRef !== undefined && hasGrant({ subjectRef, toolId, version });
        return { resourceRef: ref, revision: 1, published: true, integrityValid: true, aclAllows: granted };
      });
    },
  };
}

export function createFailClosedAgentPolicyReplica(now: () => number = Date.now): AgentPolicyReplica {
  const auditLedger = createAgentAuditLedger(() => new Date(now()));
  const unavailable = () => {
    throw new Error("Agent policy fact sources are unavailable.");
  };
  const pdp = new PolicyDecisionPoint(
    { subject: unavailable, device: unavailable, resources: unavailable },
    { admitDecision: unavailable },
    { sign: unavailable, verify: () => false },
    now,
  );
  return { pdp, auditLedger };
}
