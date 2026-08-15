#!/usr/bin/env node
import { createServer } from "node:http";
import { corsHeaders, createOllamaLabGateway, securityHeaders } from "./ollama-lab-gateway-core.mjs";
import { createOllamaLabStore } from "./ollama-lab-store.mjs";

const port = Number.parseInt(process.env.LENS_LAB_GATEWAY_PORT ?? "8080", 10);
if (process.env.NODE_ENV === "production" || process.env.LENS_LAB_GATEWAY_MODE !== "public-test-only" || !Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error("This public-test-only gateway cannot run in production.");
}

const gateway = createOllamaLabGateway({
  mode: process.env.LENS_LAB_GATEWAY_MODE,
  accessToken: process.env.LENS_LAB_GATEWAY_TOKEN ?? "",
  allowedClientIp: process.env.LENS_LAB_ALLOWED_CLIENT_IP ?? "",
  model: process.env.LENS_OLLAMA_MODEL ?? "llama3.2",
  rateLimit: {
    capacity: Number.parseInt(process.env.LENS_LAB_RATE_LIMIT_CAPACITY ?? "20", 10),
    refillPerSecond: Number.parseFloat(process.env.LENS_LAB_RATE_LIMIT_REFILL_PER_SECOND ?? "5"),
  },
});
const allowedOrigin = process.env.LENS_LAB_ALLOWED_ORIGIN;
const store = createOllamaLabStore(process.env.LENS_LAB_DATABASE_PATH ?? "data/lens-lab.sqlite");

function write(response, result, headers = {}) {
  response.writeHead(result.status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    ...securityHeaders(),
    ...headers,
  });
  response.end(JSON.stringify(result.body));
}

async function readBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 16 * 1024) throw new Error("body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const server = createServer(async (request, response) => {
  const headers = corsHeaders(request.headers.origin, allowedOrigin);
  if (request.method === "OPTIONS") {
    if (!headers["access-control-allow-origin"]) return write(response, { status: 403, body: { error: { code: "FORBIDDEN" } } });
    response.writeHead(204, headers);
    return response.end();
  }
  const controller = new AbortController();
  request.once("aborted", () => controller.abort());
  try {
    const body = await readBody(request);
    const result = await gateway.handle({
      method: request.method ?? "",
      path: new URL(request.url ?? "/", "http://gateway.internal").pathname,
      authorization: request.headers.authorization,
      remoteAddress: request.socket.remoteAddress,
      body,
      signal: controller.signal,
    });
    if (result.status === 200) {
      const payload = JSON.parse(body);
      try {
        store.recordTurn({ clientIp: request.socket.remoteAddress ?? "unknown", prompt: payload.prompt, output: result.body.output });
      } catch {
        return write(response, { status: 503, body: { error: { code: "DEPENDENCY_UNAVAILABLE" } } }, headers);
      }
    }
    write(response, result, headers);
  } catch {
    write(response, { status: 400, body: { error: { code: "INVALID_ARGUMENT" } }, }, headers);
  }
});

server.headersTimeout = 10_000;
server.requestTimeout = 65_000;
server.keepAliveTimeout = 5_000;
server.listen(port, "0.0.0.0", () => console.log(`Lens public-test gateway listening on port ${port}.`));
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => server.close(() => { store.close(); process.exit(0); }));
