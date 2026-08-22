const GEMINI_API_ROOT = "https://generativelanguage.googleapis.com/v1beta";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_MODELS_PAGES = 20;

export interface GeminiModel {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
}

interface GeminiApiModel {
  name?: unknown;
  displayName?: unknown;
  description?: unknown;
  supportedGenerationMethods?: unknown;
  inputTokenLimit?: unknown;
  outputTokenLimit?: unknown;
}

interface GeminiGatewayOptions {
  apiKey?: string;
  fetcher?: typeof fetch;
  ttlMs?: number;
  timeoutMs?: number;
  apiRoot?: string;
}

export interface GeminiGenerationOptions {
  /** Additional system policy, kept separate from user/context content. */
  systemInstruction?: string;
  signal?: AbortSignal;
}

export class GeminiGatewayError extends Error {
  readonly code: "NOT_CONFIGURED" | "UNAVAILABLE" | "INVALID_MODEL" | "INVALID_RESPONSE" | "RATE_LIMITED";
  constructor(code: GeminiGatewayError["code"], message = code) {
    super(message);
    this.name = "GeminiGatewayError";
    this.code = code;
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function textModel(raw: GeminiApiModel): GeminiModel | null {
  const name = text(raw.name);
  const displayName = text(raw.displayName);
  const methods = Array.isArray(raw.supportedGenerationMethods)
    ? raw.supportedGenerationMethods.filter((v): v is string => typeof v === "string")
    : [];
  if (!name.startsWith("models/") || !methods.includes("generateContent")) return null;
  const id = name.slice("models/".length);
  // This selector is for Gemini chat models, not other Google model families
  // (Gemma, Deep Research agents, Imagen, etc.) or moving `latest` aliases.
  // Exact versioned IDs keep the selected identity stable and auditable.
  if (!id.startsWith("gemini-") || id.endsWith("-latest")) return null;
  // generateContent also includes image/video/audio models. The popup is text-only.
  if (/(?:^|[-_])(image|imagen|banana|video|veo|audio|tts|speech|music|lyria|embedding|robotics|computer-use)(?:[-_]|$)/i.test(id)) return null;
  return {
    id,
    name,
    displayName: displayName || id,
    ...(text(raw.description) ? { description: text(raw.description) } : {}),
    ...(number(raw.inputTokenLimit) !== undefined ? { inputTokenLimit: number(raw.inputTokenLimit) } : {}),
    ...(number(raw.outputTokenLimit) !== undefined ? { outputTokenLimit: number(raw.outputTokenLimit) } : {}),
  };
}

async function boundedJson(response: Response): Promise<unknown> {
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > MAX_RESPONSE_BYTES) throw new GeminiGatewayError("UNAVAILABLE");
  const body = await response.text();
  if (body.length > MAX_RESPONSE_BYTES) throw new GeminiGatewayError("UNAVAILABLE");
  try { return JSON.parse(body); } catch { throw new GeminiGatewayError("INVALID_RESPONSE"); }
}

export function createGeminiGateway(options: GeminiGatewayOptions = {}) {
  const apiKey = options.apiKey?.trim();
  const fetcher = options.fetcher ?? fetch;
  const ttlMs = options.ttlMs ?? 30 * 60 * 1000;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const apiRoot = (options.apiRoot ?? GEMINI_API_ROOT).replace(/\/$/, "");
  let cached: { models: GeminiModel[]; expiresAt: number } | undefined;
  let inflight: Promise<GeminiModel[]> | undefined;

  async function request(url: string, init: RequestInit, requestTimeoutMs = timeoutMs): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    const externalSignal = init.signal;
    const abort = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener("abort", abort, { once: true });
    }
    try {
      return await fetcher(url, { ...init, signal: controller.signal });
    } catch {
      throw new GeminiGatewayError("UNAVAILABLE");
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", abort);
    }
  }

  async function listModelsUncached(): Promise<GeminiModel[]> {
    if (!apiKey) throw new GeminiGatewayError("NOT_CONFIGURED");
    const result: GeminiModel[] = [];
    let pageToken = "";
    for (let page = 0; page < MAX_MODELS_PAGES; page += 1) {
      const url = new URL(`${apiRoot}/models`);
      url.searchParams.set("pageSize", "1000");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const response = await request(url.toString(), {
        headers: { accept: "application/json", "x-goog-api-key": apiKey },
      });
      const payload = await boundedJson(response);
      if (!response.ok) throw new GeminiGatewayError("UNAVAILABLE");
      const models = payload && typeof payload === "object" && Array.isArray((payload as { models?: unknown }).models)
        ? (payload as { models: GeminiApiModel[] }).models : [];
      for (const raw of models) {
        const model = textModel(raw);
        if (model && !result.some((item) => item.id === model.id)) result.push(model);
      }
      const next = payload && typeof payload === "object" ? text((payload as { nextPageToken?: unknown }).nextPageToken) : "";
      if (!next) break;
      pageToken = next;
    }
    const sorted = result.sort((a, b) => a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id));
    // Listing must not spend generation quota. The selected model is validated
    // authoritatively on its real generateContent call, where 403/404/429 are
    // returned as typed errors. Probing every model with a synthetic generation
    // can exhaust free-tier quotas before the first user message.
    return sorted;
  }

  async function listModels(): Promise<GeminiModel[]> {
    if (cached && cached.expiresAt > Date.now()) return cached.models;
    if (!inflight) {
      inflight = listModelsUncached().then((models) => {
        cached = { models, expiresAt: Date.now() + ttlMs };
        return models;
      }).finally(() => { inflight = undefined; });
    }
    return inflight;
  }

  async function generate(prompt: string, modelId: string, generationOptions: GeminiGenerationOptions = {}): Promise<{ output: string; model: GeminiModel }> {
    const models = await listModels();
    const model = models.find((item) => item.id === modelId || item.name === modelId);
    if (!model) throw new GeminiGatewayError("INVALID_MODEL");
    const baseInstruction = `You are running through the exact Gemini API model identifier ${model.id}. If asked which model or version you are, state this exact identifier. Do not infer or substitute a model identity from training knowledge.`;
    const response = await request(`${apiRoot}/models/${encodeURIComponent(model.id)}:generateContent`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", "x-goog-api-key": apiKey ?? "" },
      signal: generationOptions.signal,
      body: JSON.stringify({
        systemInstruction: {
          parts: [{
          text: generationOptions.systemInstruction ? `${baseInstruction}\n\n${generationOptions.systemInstruction}` : baseInstruction,
          }],
        },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      }),
    }, timeoutMs);
    const payload = await boundedJson(response);
    if (response.status === 429) throw new GeminiGatewayError("RATE_LIMITED");
    if (response.status === 400 || response.status === 403 || response.status === 404) {
      cached = undefined;
      throw new GeminiGatewayError("INVALID_MODEL");
    }
    if (!response.ok) throw new GeminiGatewayError("UNAVAILABLE");
    const candidates = payload && typeof payload === "object" && Array.isArray((payload as { candidates?: unknown }).candidates)
      ? (payload as { candidates: Array<{ content?: { parts?: Array<{ text?: unknown }> } }> }).candidates : [];
    const output = candidates.flatMap((candidate) => candidate.content?.parts ?? []).map((part) => text(part.text)).filter(Boolean).join("\n").trim();
    if (!output) throw new GeminiGatewayError("INVALID_RESPONSE");
    return { output, model };
  }

  return { listModels, generate };
}

export type GeminiGateway = ReturnType<typeof createGeminiGateway>;
