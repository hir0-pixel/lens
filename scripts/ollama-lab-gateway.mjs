#!/usr/bin/env node
import { createServer } from "node:http";
import { createOllamaLabGateway } from "./ollama-lab-gateway-core.mjs";

const port = Number.parseInt(process.env.LENS_LAB_GATEWAY_PORT ?? "8080", 10);
if (process.env.NODE_ENV === "production" || process.env.LENS_LAB_GATEWAY_MODE !== "public-test-only" || !Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error("This public-test-only gateway cannot run in production.");
}

const gateway = createOllamaLabGateway({
  mode: process.env.LENS_LAB_GATEWAY_MODE,
  accessToken: process.env.LENS_LAB_GATEWAY_TOKEN ?? "",
  allowedClientIp: process.env.LENS_LAB_ALLOWED_CLIENT_IP ?? "",
  model: process.env.LENS_OLLAMA_MODEL ?? "llama3.2",
});

function write(response, result) {
  response.writeHead(result.status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
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
    write(response, result);
  } catch {
    write(response, { status: 400, body: { error: { code: "INVALID_ARGUMENT" } } });
  }
});

server.headersTimeout = 10_000;
server.requestTimeout = 65_000;
server.keepAliveTimeout = 5_000;
server.listen(port, "0.0.0.0", () => console.log(`Lens public-test gateway listening on port ${port}.`));
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => server.close(() => process.exit(0)));
