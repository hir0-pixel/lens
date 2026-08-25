import { describe, expect, it } from "vitest";
import { bootAuthorityServiceLocal, bootRuntimeSidecarLocal } from "../helpers/localServiceBoot";

const TOKEN = "l".repeat(40);
const DIGEST = `sha256:${"a".repeat(64)}`;

async function json(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

describe("local service boot helpers", () => {
  it("boots real Authority and Runtime Sidecar HTTP servers", async () => {
    const authority = await bootAuthorityServiceLocal({ AUTHORITY_WORKLOAD_TOKEN: TOKEN });
    const sidecar = await bootRuntimeSidecarLocal({ WORKLOAD_TOKEN: TOKEN });
    try {
      expect((await fetch(`${authority.url}/livez`)).status).toBe(200);
      expect((await fetch(`${sidecar.url}/healthz`)).status).toBe(200);
      expect((await fetch(`${authority.url}/readyz`)).status).toBe(200);
      expect((await fetch(`${sidecar.url}/readyz`)).status).toBe(200);

      const authorityResponse = await fetch(`${authority.url}/v1/generation-context-fences/revalidate`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-lens-authority-token": authority.workloadToken },
        body: JSON.stringify({
          request_id: "request-1",
          turn_id: "turn-1",
          subject_ref: "subject-1",
          device_ref: "device-1",
          session_ref: "session-1",
          context_digest: DIGEST,
          manifest_expires_at: Date.now() + 30_000,
          boundary: "generation_start",
          resource_refs: ["resource-1"],
          index_generation: "generation-1",
        }),
      });
      expect(authorityResponse.status).toBe(200);
      expect((await json(authorityResponse)).fence_ref).toEqual(expect.any(String));

      const sidecarResponse = await fetch(`${sidecar.url}/v1/attempts/accept`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-lens-model-workload-token": sidecar.workloadToken },
        body: JSON.stringify({
          reservation_id: "reservation-1",
          request_id: "request-1",
          turn_id: "turn-1",
          step_id: "step-1",
          request_digest: DIGEST,
          model_ref: "local-model",
          artifact_digest: DIGEST,
          endpoint_generation: "1",
          deadline_at: Date.now() + 30_000,
        }),
      });
      expect(sidecarResponse.status).toBe(200);
      expect((await json(sidecarResponse)).reservationId).toBe("reservation-1");
    } finally {
      await Promise.all([authority.close(), sidecar.close()]);
    }
  });
});
