import { SnapshotEmployeeCatalog, type ApprovedEmployeeModel } from "./service";
import type { CompanyRagProfile } from "../../services/rag-profile/companyRagProfile";

export async function loadApprovedCatalogFromBff(input: {
  catalogUrl: string;
  token: string;
  ragProfile?: CompanyRagProfile;
}): Promise<SnapshotEmployeeCatalog> {
  const origin = new URL(input.catalogUrl);
  if (origin.search || origin.hash || origin.username || origin.password) {
    throw new Error("Approved catalog URL must be a plain origin path.");
  }
  const host = origin.hostname.toLowerCase();
  const loopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
  if (!(origin.protocol === "https:" || (origin.protocol === "http:" && loopback))) {
    throw new Error("Approved catalog URL must be HTTPS or loopback HTTP.");
  }
  return new SnapshotEmployeeCatalog([], input.ragProfile, async () => {
    const response = await fetch(origin, {
      headers: { accept: "application/json", "x-lens-workload-token": input.token },
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error("Approved catalog is unavailable.");
    const body = await response.json() as { models?: Array<{ modelRef?: string; artifactDigest?: string; capabilities?: string[] }> };
    const models: ApprovedEmployeeModel[] = [];
    for (const row of body.models ?? []) {
      if (typeof row.modelRef !== "string" || typeof row.artifactDigest !== "string" || !row.artifactDigest.startsWith("sha256:")) continue;
      models.push({
        modelRef: row.modelRef,
        artifactDigest: row.artifactDigest as `sha256:${string}`,
        approvedCapabilities: row.capabilities ?? ["grounded-assistant"],
      });
    }
    return models;
  });
}
