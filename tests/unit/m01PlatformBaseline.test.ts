import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = ".";

async function readConfig<T>(relativePath: string): Promise<T> {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8")) as T;
}

describe("M01 Engineer A platform baseline", () => {
  it("denies public routing, resolver, proxy, and runtime egress paths", async () => {
    const network = await readConfig<{
      enforcement: Record<string, unknown>;
      dns: { internalZonesOnly: boolean; externalNames: string };
      egress: { runtimeAllowedDestinations: string[] };
    }>("platform/network/sovereign-boundary.json");

    expect(network.enforcement).toMatchObject({
      defaultDeny: true,
      publicDefaultRoute: "forbidden",
      publicNat: "forbidden",
      publicDnsResolvers: "forbidden",
      explicitProxy: "forbidden",
      ipv6PublicEgress: "forbidden",
      runtimeExportPath: "forbidden",
    });
    expect(network.dns).toMatchObject({ internalZonesOnly: true, externalNames: "sinkhole-and-alert" });
    expect(network.egress.runtimeAllowedDestinations).toEqual([]);
    expect(network.bmc).toMatchObject({ publicRuntimeUserRoute: false, directAdministratorPath: false, vendorCloudManagement: false });
    expect(network.controlledTransfer).toMatchObject({ runtimeInvocable: false });
  });

  it("requires attested short-lived X.509 workload identity and denies sandbox credentials", async () => {
    const identity = await readConfig<{
      issuance: Record<string, unknown>;
      delivery: Record<string, unknown>;
      denials: Record<string, unknown>;
    }>("platform/identity/workload-identity.json");

    expect(identity.issuance).toMatchObject({
      defaultCredential: "x509-svid-mtls",
      standingWorkloadCredentials: false,
    });
    expect(identity.delivery).toMatchObject({
      endpoint: "node-local-hardened-ipc",
      revocation: "current-epoch-required",
    });
    expect(identity.denials).toMatchObject({ sandboxCredentialAccess: false, clientAssertedIdentity: false });
  });

  it("requires non-exportable HSM roots and refuses unsafe cluster admission", async () => {
    const [secrets, cluster] = await Promise.all([
      readConfig<{ hsm: Record<string, unknown>; leases: Record<string, unknown> }>("platform/secrets/secrets-hsm-baseline.json"),
      readConfig<{ separation: Record<string, unknown>; kubernetes: Record<string, unknown> }>("platform/clusters/cluster-storage-baseline.json"),
    ]);

    expect(secrets.hsm).toMatchObject({
      privateRootsNonExportable: true,
      wrappingKeysNonExportable: true,
      signingKeysNonExportable: true,
      softwareRootFallback: false,
    });
    expect(secrets.leases).toMatchObject({ dynamicOnly: true, credentialsInImages: false });
    expect(secrets.disasterRecovery).toMatchObject({ checkpointMaxSeconds: 60, auditCheckpointCoupled: true });
    expect(cluster.separation).toMatchObject({
      untrustedSharesControlPlaneCredentials: false,
      restoreCellHasProductionRoute: false,
      restoreCellHasPublicOrOrdinaryUserRoute: false,
    });
    expect(cluster.kubernetes).toMatchObject({ anonymousAccess: false, defaultServiceAccountTokenAutomount: false, admissionOutage: "block-new-workloads" });
  });

  it("does not treat the unsigned cryptographic profile template as production-admissible", async () => {
    const crypto = await readConfig<{
      admissionEligible: boolean;
      status: string;
      transport: Record<string, unknown>;
      requirements: Record<string, unknown>;
    }>("platform/security/cryptographic-profile.json");

    expect(crypto.admissionEligible).toBe(false);
    expect(crypto.status).toBe("template-requires-independent-signature");
    expect(crypto.transport).toMatchObject({ minimum: "TLS-1.3", serviceAuthentication: "mutual-tls" });
    expect(crypto.requirements).toMatchObject({ customCryptography: false, hardCodedKeys: false });
  });
});
