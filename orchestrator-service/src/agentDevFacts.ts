import {
  DevAutoProvisioningResourceFactReader,
  DevAutoProvisioningSubjectDeviceDirectory,
  HmacFenceSigner,
} from "../../authority-service/src/pdpAdapter";
import { GovernanceAuthority } from "../../services/governance/GovernanceAuthority";
import type { DecisionFenceSigner, FactReaders, PolicyBundle } from "../../services/pdp/PolicyDecisionPoint";

export interface DevAgentPolicyFacts {
  factReaders: FactReaders;
  policyBundle: PolicyBundle;
  signer: DecisionFenceSigner;
}

/**
 * DEV/TEST ONLY. These facts auto-approve every subject, device, and resource
 * so the real agent PDP/fence path can be exercised locally. This must never
 * be enabled in a real deployment: without the flag, agent policy remains
 * unavailable and agent-mode requests fail closed until live IAM/MDM/document
 * governance fact readers are injected by the deployer.
 */
export function createDevAgentPolicyFacts(signingKey: string): DevAgentPolicyFacts {
  const directory = new DevAutoProvisioningSubjectDeviceDirectory();
  const resources = new DevAutoProvisioningResourceFactReader(new GovernanceAuthority());
  return {
    factReaders: {
      subject: (ref) => directory.subject(ref),
      device: (ref) => directory.device(ref),
      resources: (refs) => resources.resources(refs),
    },
    policyBundle: {
      revision: 1,
      // This is intentionally not a sha256 digest, so it cannot be mistaken
      // for a production policy artifact digest.
      digest: "dev-agent-facts:policy-v1",
      signed: true,
      evaluate: () => true,
    },
    signer: new HmacFenceSigner(Buffer.from(signingKey, "hex")),
  };
}
