import { describe, expect, it, vi } from "vitest";
import { generateIdentityGatewayResponse, getIdentityGatewayConfig, getIdentitySession, IdentityLoginRequiredError } from "../../src/shared/identity-gateway/client";

describe("identity gateway website client", () => {
  const config = { baseUrl: "https://lens-gateway.platform.internal:8444" };

  it("accepts only the internal HTTPS test gateway and refuses production builds", () => {
    expect(getIdentityGatewayConfig({ VITE_LENS_SESSION_GATEWAY_URL: config.baseUrl })).toEqual(config);
    expect(getIdentityGatewayConfig({ VITE_LENS_SESSION_GATEWAY_URL: "http://lens-gateway.platform.internal:8444" })).toBeUndefined();
    expect(getIdentityGatewayConfig({ VITE_LENS_SESSION_GATEWAY_URL: "https://example.com:8444" })).toBeUndefined();
    expect(getIdentityGatewayConfig({ PROD: true, VITE_LENS_SESSION_GATEWAY_URL: config.baseUrl })).toBeUndefined();
  });

  it("uses an HttpOnly-cookie session and CSRF token without a browser bearer token", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ subjectRef: "user-1", csrfToken: "csrf", expiresAt: 2_000 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ output: "Local answer" }), { status: 200 }));
    await expect(generateIdentityGatewayResponse("Hello", config, undefined, fetcher)).resolves.toBe("Local answer");
    expect(fetcher).toHaveBeenNthCalledWith(1, `${config.baseUrl}/v1/session`, expect.objectContaining({ credentials: "include" }));
    expect(fetcher).toHaveBeenNthCalledWith(2, `${config.baseUrl}/v1/generate`, expect.objectContaining({ credentials: "include", headers: expect.objectContaining({ "x-lens-csrf": "csrf" }) }));
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain("authorization");
  });

  it("requires login when no session cookie is accepted", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    await expect(getIdentitySession(config, fetcher)).resolves.toBeUndefined();
    await expect(generateIdentityGatewayResponse("Hello", config, undefined, fetcher)).rejects.toBeInstanceOf(IdentityLoginRequiredError);
  });
});
