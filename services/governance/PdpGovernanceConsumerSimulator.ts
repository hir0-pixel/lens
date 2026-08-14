import { GovernanceAuthority, type ResourceSecurityFacts } from "./GovernanceAuthority";

/** Consumer-side contract simulator: PDP receives facts, never an allow decision. */
export class PdpGovernanceConsumerSimulator {
  constructor(private readonly governance: GovernanceAuthority) {}

  readCurrentDocumentFacts(
    refs: readonly string[],
    requiredMinimums: Readonly<Record<string, number>> = {},
  ): ResourceSecurityFacts[] {
    return this.governance.getResourceSecurityFacts(refs, requiredMinimums);
  }
}
