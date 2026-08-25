import { GovernanceAuthority } from "../governance/GovernanceAuthority";
import type { GovernancePort, IngestionRequest } from "./IngestionService";

export class GovernanceAuthorityPortAdapter implements GovernancePort {
  constructor(
    private readonly governance: GovernanceAuthority,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private fence(versionRef: string) {
    return {
      fenceId: `ingestion-${versionRef}-${this.now()}`,
      actorRef: "ingestion",
      approverRef: "platform",
      expiresAt: this.now() + 3_600_000,
    };
  }

  async registerVersion(input: Pick<IngestionRequest, "versionRef" | "contentDigest" | "classificationRef" | "aclDigest">): Promise<{ resourceSecurityRevision: number }> {
    const facts = this.governance.registerVersion({
      documentVersionRef: input.versionRef,
      classification: input.classificationRef,
      aclDigest: input.aclDigest,
    });
    return { resourceSecurityRevision: facts.resourceSecurityRevision };
  }

  async activatePublishedVersion(input: { versionRef: string; expectedResourceSecurityRevision: number; indexGeneration: string }): Promise<{ resourceSecurityRevision: number }> {
    const facts = this.governance.mutateSecurity(
      input.versionRef,
      { publication: "active", processing: "indexed", integrity: "valid" },
      this.fence(input.versionRef),
      input.expectedResourceSecurityRevision,
    );
    return { resourceSecurityRevision: facts.resourceSecurityRevision };
  }

  async withdrawVersion(input: { versionRef: string; expectedResourceSecurityRevision: number }): Promise<void> {
    this.governance.mutateSecurity(input.versionRef, { publication: "withdrawn" }, this.fence(input.versionRef), input.expectedResourceSecurityRevision);
  }

  async getCurrentResourceSecurityRevision(versionRef: string): Promise<number> {
    return this.governance.getResourceSecurityFacts([versionRef])[0].resourceSecurityRevision;
  }
}
