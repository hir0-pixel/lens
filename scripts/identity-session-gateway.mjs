#!/usr/bin/env node
import { createServer } from "node:http";
import { createIdentitySessionGateway } from "./identity-session-gateway-core.mjs";

const port = Number.parseInt(process.env.LENS_SESSION_GATEWAY_PORT ?? "8081", 10);
const allowedOrigin = process.env.LENS_SESSION_GATEWAY_ALLOWED_ORIGIN ?? "";
const allowedClientIp = process.env.LENS_SESSION_GATEWAY_ALLOWED_CLIENT_IP ?? "";
if (process.env.NODE_ENV === "production" || process.env.LENS_SESSION_GATEWAY_MODE !== "internal-test-only" || !Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("This identity gateway is for internal testing only.");
const gateway = createIdentitySessionGateway({ mode: process.env.LENS_SESSION_GATEWAY_MODE, issuer: process.env.LENS_IDENTITY_ISSUER ?? "", clientId: process.env.LENS_SESSION_GATEWAY_CLIENT_ID ?? "", clientSecret: process.env.LENS_SESSION_GATEWAY_CLIENT_SECRET ?? "", allowedClientIp: process.env.LENS_SESSION_GATEWAY_ALLOWED_CLIENT_IP ?? "", allowedOrigin, redirectUri: process.env.LENS_SESSION_GATEWAY_REDIRECT_URI ?? "", modelBridgeUrl: process.env.LENS_INTERNAL_MODEL_BRIDGE_URL ?? "", modelBridgeToken: process.env.LENS_INTERNAL_MODEL_BRIDGE_TOKEN ?? "" });

const cors = (origin) => origin === allowedOrigin ? { "access-control-allow-origin": allowedOrigin, "access-control-allow-credentials": "true", "access-control-allow-headers": "content-type, x-lens-csrf", "access-control-allow-methods": "GET, POST, OPTIONS", vary: "Origin" } : {};
const cookie = (request, key) => request.headers.cookie?.split(";").map((item) => item.trim().split("=")).find(([name]) => name === key)?.[1];
const write = (response, status, body, headers = {}) => { response.writeHead(status, { "cache-control": "no-store", "content-type": "application/json; charset=utf-8", "content-security-policy": "default-src 'none'; frame-ancestors 'none'", "x-content-type-options": "nosniff", ...headers }); response.end(JSON.stringify(body)); };
const readJson = async (request, maxBytes = 16_384) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};
const clientIp = (request) => {
  const forwarded = request.headers["x-forwarded-for"];
  const value = (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0])?.trim() ?? request.socket.remoteAddress ?? "";
  return value.startsWith("::ffff:") ? value.slice(7) : value;
};

const server = createServer(async (request, response) => {
  if (clientIp(request) !== allowedClientIp) return write(response, 403, { error: "FORBIDDEN" });
  const origin = request.headers.origin;
  const headers = cors(origin);
  const path = new URL(request.url ?? "/", "http://gateway.internal").pathname;
  if (request.method === "OPTIONS") return Object.keys(headers).length ? (response.writeHead(204, headers), response.end()) : write(response, 403, { error: "FORBIDDEN" });
  if (request.method === "GET" && path === "/auth/login") return response.writeHead(302, { location: gateway.beginLogin(), "cache-control": "no-store" }), response.end();
  if (request.method === "GET" && path === "/auth/callback") {
    try {
      const url = new URL(request.url ?? "/", "http://gateway.internal");
      const session = await gateway.finishLogin({ state: url.searchParams.get("state") ?? "", code: url.searchParams.get("code") ?? "" });
      response.writeHead(302, { location: allowedOrigin, "set-cookie": `lens_internal_session=${session.sessionId}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=1800`, "cache-control": "no-store" });
      return response.end();
    } catch { return write(response, 401, { error: "UNAUTHENTICATED" }); }
  }
  if (origin !== allowedOrigin) return write(response, 403, { error: "FORBIDDEN" });
  if (request.method === "GET" && path === "/v1/session") {
    const session = gateway.bootstrapSession(cookie(request, "lens_internal_session"));
    return session ? write(response, 200, session, headers) : write(response, 401, { error: "UNAUTHENTICATED" }, headers);
  }
  if (request.method === "POST" && path === "/auth/logout") {
    const session = gateway.session(cookie(request, "lens_internal_session"), request.headers["x-lens-csrf"]);
    if (!session) return write(response, 401, { error: "UNAUTHENTICATED" }, headers);
    gateway.revoke(cookie(request, "lens_internal_session"));
    return write(response, 204, {}, { ...headers, "set-cookie": "lens_internal_session=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0" });
  }
  if (request.method === "POST" && path === "/v1/generate") {
    try {
      const body = await readJson(request);
      const result = await gateway.generate(cookie(request, "lens_internal_session"), request.headers["x-lens-csrf"], body, AbortSignal.timeout(120_000));
      return write(response, result.status, result.body, headers);
    } catch (error) {
      return write(response, error?.message === "REQUEST_TOO_LARGE" ? 413 : 400, { error: error?.message === "REQUEST_TOO_LARGE" ? "REQUEST_TOO_LARGE" : "INVALID_REQUEST" }, headers);
    }
  }
  return write(response, 404, { error: "NOT_FOUND" }, headers);
});

server.listen(port, "0.0.0.0", () => console.log(`Lens internal identity gateway listening on port ${port}.`));
