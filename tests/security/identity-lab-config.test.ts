import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("identity lab configuration", () => {
  it("keeps Keycloak internal and exposes only the TLS edge on loopback", () => {
    const compose = readFileSync(resolve(process.cwd(), "deploy/on-prem/identity/compose.yaml"), "utf8");
    const caddyfile = readFileSync(resolve(process.cwd(), "deploy/on-prem/identity/Caddyfile"), "utf8");
    const realm = JSON.parse(readFileSync(resolve(process.cwd(), "deploy/on-prem/identity/lens-internal-realm.json"), "utf8"));
    const provisioner = readFileSync(resolve(process.cwd(), "deploy/on-prem/identity/provision-session-client.ps1"), "utf8");
    const recovery = readFileSync(resolve(process.cwd(), "deploy/on-prem/identity/recover-session-client.ps1"), "utf8");

    expect(compose).toContain("KC_HOSTNAME: https://identity.platform.internal:8443");
    expect(compose).toContain('KC_PROXY_HEADERS: xforwarded');
    expect(compose).toContain("LENS_SESSION_GATEWAY_CLIENT_SECRET: ${LENS_SESSION_GATEWAY_CLIENT_SECRET}");
    expect(compose).toContain('"${LENS_IDENTITY_BIND_ADDRESS:-127.0.0.1}:8444:8444"');
    expect(compose).toContain('"${LENS_IDENTITY_BIND_ADDRESS:-127.0.0.1}:8443:8443"');
    expect(compose).toContain("internal: true");
    const edge = compose.slice(compose.indexOf("  edge:"), compose.indexOf("  session_gateway:"));
    const sessionStart = compose.indexOf("  session_gateway:");
    const sessionGateway = compose.slice(sessionStart, compose.indexOf("\nnetworks:\n", sessionStart));
    expect(edge).toContain('"host.docker.internal:host-gateway"');
    expect(edge).toContain("LENS_EDGE_RELAY_TOKEN: ${LENS_EDGE_RELAY_TOKEN}");
    expect(edge).toContain("LENS_SESSION_GATEWAY_EDGE_TOKEN: ${LENS_SESSION_GATEWAY_EDGE_TOKEN}");
    expect(sessionGateway).not.toContain("extra_hosts:");
    expect(sessionGateway).not.toContain("LENS_EDGE_RELAY_TOKEN");
    expect(sessionGateway).toContain("LENS_SESSION_GATEWAY_EDGE_TOKEN: ${LENS_SESSION_GATEWAY_EDGE_TOKEN}");
    expect(sessionGateway).not.toContain("LENS_SESSION_GATEWAY_ALLOWED_CLIENT_IP");
    expect(sessionGateway).toContain("- identity_internal");
    expect(caddyfile).toContain("https://identity.platform.internal:8443");
    expect(caddyfile).toContain("tls internal");
    expect(caddyfile).toContain("https://lens-gateway.platform.internal:8444");
    expect(caddyfile).toContain("header_up X-Lens-Identity-Edge {$LENS_SESSION_GATEWAY_EDGE_TOKEN}");
    expect(caddyfile).toContain("handle /v1/lab/generate");
    expect(caddyfile).toContain("reverse_proxy host.docker.internal:8080");
    expect(caddyfile).toContain("header_up X-Lens-Edge-Relay {$LENS_EDGE_RELAY_TOKEN}");
    expect(realm.clients).toEqual([
      expect.objectContaining({
        clientId: "lens-session-gateway",
        clientAuthenticatorType: "client-secret",
        secret: "${LENS_SESSION_GATEWAY_CLIENT_SECRET}",
        publicClient: false,
        standardFlowEnabled: true,
        implicitFlowEnabled: false,
        directAccessGrantsEnabled: false,
        serviceAccountsEnabled: false,
        redirectUris: ["https://lens-gateway.platform.internal:8444/auth/callback"],
        webOrigins: ["http://localhost:1420"],
        attributes: { "pkce.code.challenge.method": "S256" },
      }),
    ]);
    expect(provisioner).toContain("$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path");
    expect(provisioner).toContain('$provision = $provision.Replace("`r`n", "`n").Replace("`r", "`n")');
    expect(provisioner).toContain("[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($provision))");
    expect(provisioner).toContain("printf '%s' '$encodedProvision' | base64 -d | /bin/sh");
    expect(provisioner).not.toContain("$provision | docker exec -i");
    expect(provisioner.match(/param\([\s\S]*?\)/)?.[0]).not.toContain("$PSScriptRoot");
    expect(provisioner).toContain("--client \"$LENS_ADMIN_CLIENT_ID\" --secret \"$LENS_ADMIN_CLIENT_SECRET\"");
    expect(provisioner).toContain("trap cleanup EXIT");
    expect(provisioner).toContain('"$KCADM" delete "clients/$admin_uuid"');
    expect(recovery).toContain("bootstrap-admin service");
    expect(recovery).toContain("--client-secret:env KC_TEMP_ADMIN_CLIENT_SECRET");
    expect(recovery).toContain("-RemoveAdminClientAfterProvisioning");
    expect(recovery).toContain("finally {");
    expect(recovery.match(/param\([\s\S]*?\)/)?.[0]).not.toContain("$PSScriptRoot");
  });
});
