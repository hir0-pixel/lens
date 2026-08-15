export interface LabGatewayConfig {
  baseUrl: string;
  accessToken: string;
}

export class LabGatewayError extends Error {}

function normalizeBaseUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" || url.username || url.password || url.search || url.hash) return undefined;
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

/** Build-time public-test configuration. Never enable this in a production build. */
export function getLabGatewayConfig(environment: Record<string, string | boolean | undefined> = import.meta.env): LabGatewayConfig | undefined {
  const baseUrl = typeof environment.VITE_LENS_LAB_GATEWAY_URL === "string" ? normalizeBaseUrl(environment.VITE_LENS_LAB_GATEWAY_URL) : undefined;
  const accessToken = typeof environment.VITE_LENS_LAB_GATEWAY_TOKEN === "string" ? environment.VITE_LENS_LAB_GATEWAY_TOKEN.trim() : "";
  return baseUrl && accessToken.length >= 32 ? { baseUrl, accessToken } : undefined;
}

export async function generateLabGatewayResponse(prompt: string, config: LabGatewayConfig, signal?: AbortSignal): Promise<string> {
  const response = await fetch(`${config.baseUrl}/v1/lab/generate`, {
    method: "POST",
    headers: { authorization: `Bearer ${config.accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ publicTest: true, prompt }),
    signal,
  });
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new LabGatewayError("The test gateway returned an invalid response."); }
  if (!response.ok || !payload || typeof payload !== "object" || typeof (payload as { output?: unknown }).output !== "string") {
    throw new LabGatewayError("The test gateway is unavailable.");
  }
  return (payload as { output: string }).output;
}
