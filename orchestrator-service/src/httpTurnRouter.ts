import { randomUUID } from "node:crypto";
import type { TurnRouterLLMPort } from "./router";

type FetchPort = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const MAX_RESPONSE_BYTES = 64 * 1024;

function internalOrigin(value: string): URL {
  const endpoint = new URL(value);
  const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/") {
    throw new Error("MODEL_RUNTIME_URL must be a plain internal origin.");
  }
  if (endpoint.protocol === "https:" && isInternalHost(endpoint.hostname)) return endpoint;
  if (endpoint.protocol === "http:" && loopbackHosts.has(endpoint.hostname)) return endpoint;
  throw new Error("MODEL_RUNTIME_URL must use HTTPS or loopback HTTP.");
}

function isInternalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".internal")) return true;
  const parts = host.split(".").map(Number);
  if (parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    return parts[0] === 10 || parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
  }
  return host.startsWith("fc") || host.startsWith("fd");
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) throw new Error("ROUTER_INVALID_RESPONSE");
  if (!response.body) throw new Error("ROUTER_INVALID_RESPONSE");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("ROUTER_INVALID_RESPONSE");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8"));
  } catch {
    throw new Error("ROUTER_INVALID_RESPONSE");
  }
}

function buildClassificationPrompt(text: string, history: readonly { role: "user" | "assistant"; text: string }[]): string {
  const historyLines = history.map((turn) => `${turn.role}: ${turn.text}`).join("\n");
  return [
    "Classify the following user turn for a governed enterprise RAG assistant.",
    "Respond with exactly one JSON object, no prose, matching this schema:",
    '{"route":"NO_RETRIEVAL"|"SINGLE_RETRIEVAL"|"MULTI_RETRIEVAL"|"CLARIFY","standalone_query":"<bounded standalone query, empty string if not applicable>","profile_selector":"<required only for SINGLE_RETRIEVAL/MULTI_RETRIEVAL>","reason_code":"<bounded reason enum>","confidence_bucket":"LOW"|"MEDIUM"|"HIGH"}',
    historyLines ? `Conversation so far:\n${historyLines}` : "No prior conversation.",
    `Current turn: ${text}`,
  ].join("\n");
}

/**
 * NOT the production router wiring. This calls the internal inference
 * control plane's /v1/inference/generate endpoint directly, bypassing the
 * Model Gateway's scheduler reservation, one-use step fence, and cost
 * sub-envelope machinery entirely — exactly the "unbudgeted call" pattern
 * Doc 004 item 7 requires the production router NOT to use. It exists as a
 * lightweight test/wire-contract double (see routerWireIntegration.test.ts).
 * Production wiring is `GatewayTurnRouterLLMPort` in service.ts, which
 * dispatches through the same ModelGateway used for final generation with
 * its own fresh model-use authorization, reservation, fence, and budget.
 *
 * DEV/TEST ONLY. `orchestrator-service/src/service.ts`'s `classifyRoute`
 * dependency only mints AuthorizeModelUse/Cost/Agent-step authority when
 * `this.turnRouter instanceof GatewayTurnRouterLLMPort` — an instance of
 * THIS class never receives that authority and dispatches unauthorized if
 * ever wired into production. `main.ts` never constructs this class (it
 * always sets `useGatewayTurnRouter: true`); it must stay that way.
 */
export class HttpTurnRouterLLMPort implements TurnRouterLLMPort {
  private readonly origin: URL;

  constructor(
    serviceUrl: string,
    private readonly workloadToken: string,
    private readonly fetcher: FetchPort = fetch,
    private readonly timeoutMs = 5_000,
  ) {
    this.origin = internalOrigin(serviceUrl);
    if (workloadToken.length < 32) throw new Error("Router model workload token must contain at least 32 characters.");
  }

  async classify(
    input: { text: string; history: readonly { role: "user" | "assistant"; text: string }[] },
    signal: AbortSignal,
  ): Promise<unknown> {
    const prompt = buildClassificationPrompt(input.text, input.history);
    const deadlineSignal = AbortSignal.timeout(this.timeoutMs);
    const response = await this.fetcher(new URL("/v1/inference/generate", this.origin), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "x-lens-model-workload-token": this.workloadToken },
      body: JSON.stringify({
        reservation_id: `router:${randomUUID()}`,
        fence: 1,
        endpoint_ref: "router",
        scope_id: "router",
        deadline_at: Date.now() + this.timeoutMs,
        chunks: [prompt],
      }),
      signal: AbortSignal.any([signal, deadlineSignal]),
    });
    if (!response.ok) throw new Error("ROUTER_UNAVAILABLE");
    const payload = await readBoundedJson(response);
    const record = payload as Record<string, unknown>;
    if (typeof record.output !== "string") throw new Error("ROUTER_INVALID_RESPONSE");
    try {
      return JSON.parse(record.output);
    } catch {
      // Not valid JSON — classifyTurn's own schema validation treats an
      // unparseable/malformed response as absent and falls back
      // deterministically. This is not an error state for the caller.
      return undefined;
    }
  }
}
