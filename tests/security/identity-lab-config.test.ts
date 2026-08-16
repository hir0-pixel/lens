import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("identity lab configuration", () => {
  it("keeps Keycloak internal and exposes only the TLS edge on loopback", () => {
    const compose = readFileSync(resolve(process.cwd(), "deploy/on-prem/identity/compose.yaml"), "utf8");
    const caddyfile = readFileSync(resolve(process.cwd(), "deploy/on-prem/identity/Caddyfile"), "utf8");

    expect(compose).toContain("KC_HOSTNAME: https://identity.platform.internal:8443");
    expect(compose).toContain('KC_PROXY_HEADERS: xforwarded');
    expect(compose).toContain('"${LENS_IDENTITY_BIND_ADDRESS:-127.0.0.1}:8444:8444"');
    expect(compose).toContain('"${LENS_IDENTITY_BIND_ADDRESS:-127.0.0.1}:8443:8443"');
    expect(compose).toContain("internal: true");
    expect(compose).toContain('"host.docker.internal:host-gateway"');
    expect(caddyfile).toContain("https://identity.platform.internal:8443");
    expect(caddyfile).toContain("tls internal");
    expect(caddyfile).toContain("https://lens-gateway.platform.internal:8444");
  });
});
