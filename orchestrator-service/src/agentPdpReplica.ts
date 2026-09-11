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
