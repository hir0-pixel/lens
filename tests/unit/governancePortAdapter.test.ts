import { describe, expect, it } from "vitest";
import { GovernanceAuthority } from "../../services/governance/GovernanceAuthority";
import { GovernanceAuthorityPortAdapter } from "../../services/ingestion";

const digest = (letter: string): `sha256:${string}` => `sha256:${letter.repeat(64)}`;
const fenceNow = 1_000;

describe("GovernanceAuthorityPortAdapter", () => {
  it("registers, activates with a revision fence, and withdraws", async () => {
    const governance = new GovernanceAuthority(() => fenceNow);
    const adapter = new GovernanceAuthorityPortAdapter(governance, () => fenceNow);
    expect(await adapter.registerVersion({ versionRef: "version-1", contentDigest: digest("a"), classificationRef: "internal", aclDigest: digest("b") })).toEqual({ resourceSecurityRevision: 1 });
    expect(await adapter.activatePublishedVersion({ versionRef: "version-1", expectedResourceSecurityRevision: 1, indexGeneration: "generation-1" })).toEqual({ resourceSecurityRevision: 2 });
    await expect(adapter.activatePublishedVersion({ versionRef: "version-1", expectedResourceSecurityRevision: 1, indexGeneration: "generation-2" })).rejects.toMatchObject({ code: "STALE_AUTHORITY" });
    await adapter.withdrawVersion({ versionRef: "version-1", expectedResourceSecurityRevision: 2 });
    expect(governance.getResourceSecurityFacts(["version-1"])[0]).toMatchObject({ publication: "withdrawn", resourceSecurityRevision: 3 });
  });
});
