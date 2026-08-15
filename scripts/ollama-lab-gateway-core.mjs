import { timingSafeEqual } from "node:crypto";

const MAX_PROMPT_BYTES = 12 * 1024;

function error(status, code) {
  return { status, body: { error: { code } } };
}

function matchesSecret(presented, expected) {
  const actual = Buffer.from(presented);
  const target = Buffer.from(expected);
  return actual.length === target.length && timingSafeEqual(actual, target);
}

function normalizeAddress(address) {
  return address.startsWith("::ffff:") ? address.slice(7) : address;
}

function requireLoopbackEndpoint(value) {
  const endpoint = new URL(value);
  if (endpoint.protocol !== "http:" || (endpoint.hostname !== "127.0.0.1" && endpoint.hostname !== "[::1]") || endpoint.pathname !== "/api/generate" || endpoint.search || endpoint.hash) {
    throw new Error("The Ollama endpoint must be node-local.");
  }
  return endpoint;
}

export function corsHeaders(origin, allowedOrigin) {
  if (!allowedOrigin || origin !== allowedOrigin) return {};
  return {
    "access-control-allow-origin": allowedOrigin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "600",
    vary: "Origin",
  };
}

/**
 * Non-production transport for public test prompts only. It is intentionally
 * separate from the authenticated, release-gated Lens product workflow.
 */
export function createOllamaLabGateway(options) {
  if (options.mode !== "public-test-only" || !options.accessToken || options.accessToken.length < 32 || !options.allowedClientIp || !options.model) {
    throw new Error("Invalid lab gateway configuration.");
  }
  const endpoint = requireLoopbackEndpoint(options.endpoint ?? "http://127.0.0.1:11434/api/generate");
  const timeoutMs = options.timeoutMs ?? 60_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new Error("Invalid lab gateway timeout.");
  const fetcher = options.fetcher ?? fetch;

  return {
    async handle(request) {
      if (normalizeAddress(request.remoteAddress ?? "") !== options.allowedClientIp) return error(403, "FORBIDDEN");
      if (request.method !== "POST" || request.path !== "/v1/lab/generate") return error(404, "NOT_FOUND");
      const authorization = request.authorization ?? "";
      if (!authorization.startsWith("Bearer ") || !matchesSecret(authorization.slice(7), options.accessToken)) return error(401, "UNAUTHENTICATED");

      let body;
      try { body = JSON.parse(request.body); } catch { return error(400, "INVALID_ARGUMENT"); }
      if (body?.publicTest !== true || typeof body?.prompt !== "string" || !body.prompt.trim() || Buffer.byteLength(body.prompt, "utf8") > MAX_PROMPT_BYTES) return error(400, "INVALID_ARGUMENT");

      const controller = new AbortController();
      const onAbort = () => controller.abort();
      request.signal?.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(onAbort, timeoutMs);
      try {
        const response = await fetcher(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ model: options.model, prompt: body.prompt, stream: false }),
          signal: controller.signal,
        });
        if (!response.ok) return error(503, "DEPENDENCY_UNAVAILABLE");
        const payload = await response.json();
        if (payload?.done !== true || typeof payload.response !== "string") return error(503, "DEPENDENCY_UNAVAILABLE");
        return { status: 200, body: { output: payload.response } };
      } catch {
        return error(503, "DEPENDENCY_UNAVAILABLE");
      } finally {
        clearTimeout(timer);
        request.signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}
