#!/usr/bin/env node
/** M01 Engineer A gate: fail closed on platform trust-baseline regressions. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  network: "platform/network/sovereign-boundary.json",
  identity: "platform/identity/workload-identity.json",
  secrets: "platform/secrets/secrets-hsm-baseline.json",
  crypto: "platform/security/cryptographic-profile.json",
  time: "platform/time/secure-time-baseline.json",
  cluster: "platform/clusters/cluster-storage-baseline.json",
};
function fail(message) { console.error(`M01 preflight: ${message}`); process.exit(1); }
function read(name) {
  const file = path.join(root, files[name]);
  if (!existsSync(file)) fail(`required baseline is missing: ${files[name]}`);
  return JSON.parse(readFileSync(file, "utf8"));
}

const network = read("network");
const identity = read("identity");
const secrets = read("secrets");
const crypto = read("crypto");
const time = read("time");
const cluster = read("cluster");

const enforce = network.enforcement ?? {};
for (const [key, value] of Object.entries({ defaultDeny: true, publicDefaultRoute: "forbidden", publicNat: "forbidden", publicDnsResolvers: "forbidden", explicitProxy: "forbidden", ipv6PublicEgress: "forbidden", runtimeExportPath: "forbidden" })) {
  if (enforce[key] !== value) fail(`network policy must set ${key}=${value}`);
}
if (network.dns?.internalZonesOnly !== true || network.dns?.externalNames !== "sinkhole-and-alert" || network.egress?.runtimeAllowedDestinations?.length !== 0) fail("DNS or runtime egress permits a non-sovereign route.");
for (const zone of ["runtime", "security", "management", "bmc-oob", "untrusted-processing", "restore-cell"]) if (!network.zones?.includes(zone)) fail(`missing required network zone: ${zone}`);
if (network.edge?.persistentData !== "signed-static-ui-assets-only" || network.controlledTransfer?.runtimeInvocable !== false || network.bmc?.publicRuntimeUserRoute !== false || network.bmc?.directAdministratorPath !== false || network.bmc?.vendorCloudManagement !== false) fail("edge, transfer, or BMC baseline permits a sovereign-boundary bypass.");

if (identity.issuance?.defaultCredential !== "x509-svid-mtls" || identity.issuance?.bearerJwtSvid !== "forbidden-except-reviewed-profile" || identity.issuance?.standingWorkloadCredentials !== false || identity.delivery?.endpoint !== "node-local-hardened-ipc" || identity.delivery?.revocation !== "current-epoch-required" || identity.denials?.sandboxCredentialAccess !== false) fail("workload identity is not short-lived, attested, or sandbox-isolated.");
if (!identity.issuance.nodeAttestation?.includes("hardware-backed-measured-boot") || !identity.issuance.workloadAttestation?.includes("admitted-image-digest")) fail("workload identity lacks independent node or image attestation.");

if (secrets.service?.onPremisesOnly !== true || secrets.service?.publicControlPlane !== false || secrets.service?.cloudKms !== false || secrets.service?.runtimeInternetDependency !== false || secrets.service?.metadataStore?.voters !== 5 || secrets.service?.metadataStore?.placement !== "2-2-1-independent-failure-domains") fail("secrets service violates sovereign quorum requirements.");
if (secrets.hsm?.privateRootsNonExportable !== true || secrets.hsm?.wrappingKeysNonExportable !== true || secrets.hsm?.signingKeysNonExportable !== true || secrets.hsm?.softwareRootFallback !== false || secrets.leases?.dynamicOnly !== true || secrets.leases?.expiryBehavior !== "deny" || secrets.leases?.credentialsInImages !== false || secrets.sensitiveOperations?.auditAdmissionRequired !== true) fail("secrets baseline permits exportable, standing, or unaudited credentials.");
if (secrets.disasterRecovery?.checkpointMaxSeconds !== 60 || secrets.disasterRecovery?.auditCheckpointCoupled !== true || secrets.disasterRecovery?.staleOrUnverifiableCheckpoint !== "deny-issuance-key-operations-and-protected-admission") fail("secrets DR checkpoint does not preserve Class A fail-closed behavior.");

if (crypto.admissionEligible !== false || crypto.status !== "template-requires-independent-signature" || crypto.transport?.minimum !== "TLS-1.3" || crypto.transport?.serviceAuthentication !== "mutual-tls" || crypto.transport?.silentDowngrade !== false || crypto.requirements?.customCryptography !== false || crypto.requirements?.hardCodedKeys !== false) fail("cryptographic profile can be admitted before independent signed approval.");

if (time.servers?.minimum < 3 || time.servers?.independentFailureDomains !== true || time.servers?.runtimePublicNtp !== false || time.client?.monotonicDurations !== true || time.client?.uncertaintyExceeded !== "deny-new-leases-fences-certificates-and-signatures") fail("secure-time baseline does not fail security actions closed.");

for (const name of ["production", "management-security", "untrusted-processing", "restore-cell"]) if (!cluster.clusters?.includes(name)) fail(`missing cluster: ${name}`);
if (cluster.separation?.untrustedSharesControlPlaneCredentials !== false || cluster.separation?.untrustedSharesUnrestrictedNodesWithSecurity !== false || cluster.separation?.restoreCellHasProductionRoute !== false || cluster.separation?.restoreCellHasPublicOrOrdinaryUserRoute !== false || cluster.kubernetes?.anonymousAccess !== false || cluster.kubernetes?.sharedClusterAdmin !== false || cluster.kubernetes?.defaultServiceAccountTokenAutomount !== false || cluster.kubernetes?.admissionOutage !== "block-new-workloads" || cluster.storage?.protectedValuesEncryptedWithSecretsKeys !== true || cluster.storage?.backupOperatorsPlaintextAccess !== false || cluster.storage?.backupOperatorDecryptionAuthority !== false || cluster.storage?.classAReplication !== "five-voter-2-2-1") fail("cluster or storage baseline permits a trust-boundary bypass.");

console.log("M01 Engineer A platform trust preflight passed.");
