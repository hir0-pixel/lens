import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

const MAX_BODY_BYTES = 256 * 1024;

export type InternalRoute = (body: Record<string, unknown>) => Promise<Record<string, unknown> | void>;

export interface InternalHttpService {
  server: Server;
  listen(port: number, host: string): Promise<void>;
  close(): Promise<void>;
  setReady(value: boolean): void;
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    req.on("data", (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        settled = true;
        reject(new Error("PAYLOAD_TOO_LARGE"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("INVALID_JSON"));
      }
    });
    req.on("error", reject);
  });
}

function respond(res: ServerResponse, status: number, payload: Record<string, unknown>): void {
  if (res.destroyed || res.writableEnded) return;
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(body);
}

export type InternalStreamRoute = (body: Record<string, unknown>, res: ServerResponse, req: IncomingMessage) => Promise<void>;

export function createInternalServiceHttp(options: {
  workloadToken: string;
  tokenHeader: string;
  routes: Record<string, InternalRoute>;
  streamRoutes?: Record<string, InternalStreamRoute>;
  mapError?: (error: unknown) => { status: number; body: Record<string, unknown> };
}): InternalHttpService {
  let ready = false;
  const server = createServer((req, res) => {
    const url = req.url?.split("?")[0] ?? "";
    if (req.method === "GET" && url === "/healthz") {
      respond(res, 200, { status: "ok" });
      return;
    }
    if (req.method === "GET" && url === "/readyz") {
      respond(res, ready ? 200 : 503, { ready });
      return;
    }
    if (req.method !== "POST") {
      respond(res, 405, { error: "METHOD_NOT_ALLOWED" });
      return;
    }
    const token = req.headers[options.tokenHeader];
    if (typeof token !== "string" || !safeEqual(token, options.workloadToken)) {
      respond(res, 401, { error: "UNAUTHENTICATED" });
      return;
    }
    if (!ready) {
      respond(res, 503, { error: "NOT_READY" });
      return;
    }
    const streamRoute = options.streamRoutes?.[url];
    const route = options.routes[url];
    if (!route && !streamRoute) {
      respond(res, 404, { error: "NOT_FOUND" });
      return;
    }
    void readJsonBody(req, MAX_BODY_BYTES)
      .then((payload) => {
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("INVALID_JSON");
        const body = payload as Record<string, unknown>;
        if (streamRoute) return streamRoute(body, res, req);
        return route!(body).then((result) => {
          respond(res, 200, (result ?? {}) as Record<string, unknown>);
        });
      })
      .catch((error: unknown) => {
        if (res.headersSent) {
          res.destroy();
          return;
        }
        if (error instanceof Error && error.message === "PAYLOAD_TOO_LARGE") respond(res, 413, { error: "PAYLOAD_TOO_LARGE" });
        else if (error instanceof Error && error.message === "INVALID_JSON") respond(res, 400, { error: "INVALID_ARGUMENT" });
        else if (options.mapError) {
          const mapped = options.mapError(error);
          respond(res, mapped.status, mapped.body);
        } else respond(res, 500, { error: "INTERNAL" });
      });
  });

  return {
    server,
    listen: (port, host) => new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => resolve());
    }),
    close: () => new Promise((resolve) => server.close(() => resolve())),
    setReady: (value) => { ready = value; },
  };
}
