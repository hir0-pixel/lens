import { describe, expect, it, vi } from "vitest";
import { generateLabGatewayResponse, getLabGatewayConfig, LabGatewayError } from "../../src/shared/lab-gateway/client";

describe("lab gateway website client", () => {
  it("accepts only explicit HTTP test configuration", () => {
    expect(getLabGatewayConfig({ VITE_LENS_LAB_GATEWAY_URL: "http://10.164.13.57:8080", VITE_LENS_LAB_GATEWAY_TOKEN: "a".repeat(32) })).toEqual({ baseUrl: "http://10.164.13.57:8080", accessToken: "a".repeat(32) });
    expect(getLabGatewayConfig({ VITE_LENS_LAB_GATEWAY_URL: "https://gateway.example", VITE_LENS_LAB_GATEWAY_TOKEN: "a".repeat(32) })).toBeUndefined();
    expect(getLabGatewayConfig({ VITE_LENS_LAB_GATEWAY_URL: "http://8.8.8.8:8080", VITE_LENS_LAB_GATEWAY_TOKEN: "a".repeat(32) })).toBeUndefined();
    expect(getLabGatewayConfig({ PROD: true, VITE_LENS_LAB_GATEWAY_URL: "http://10.164.13.57:8080", VITE_LENS_LAB_GATEWAY_TOKEN: "a".repeat(32) })).toBeUndefined();
  });

  it("sends the public-test envelope and rejects unsafe responses", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, json: async () => ({ output: "Local answer" }) } as Response);
    await expect(generateLabGatewayResponse("Hello", { baseUrl: "http://10.164.13.57:8080", accessToken: "a".repeat(32) })).resolves.toBe("Local answer");
    expect(fetcher).toHaveBeenCalledWith("http://10.164.13.57:8080/v1/lab/generate", expect.objectContaining({ method: "POST", body: '{"publicTest":true,"prompt":"Hello"}' }));
    fetcher.mockResolvedValueOnce({ ok: false, json: async () => ({ error: { code: "FORBIDDEN" } }) } as Response);
    await expect(generateLabGatewayResponse("Hello", { baseUrl: "http://10.164.13.57:8080", accessToken: "a".repeat(32) })).rejects.toBeInstanceOf(LabGatewayError);
    fetcher.mockRestore();
  });
});
