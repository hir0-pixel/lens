export interface AuthSessionInfo {
  authenticated: boolean;
  subject?: string;
  name?: string;
  email?: string;
  picture?: string;
  preferredUsername?: string;
  expiresAt?: number;
  administrator?: boolean;
  adminSubjectsConfigured?: boolean;
}

export interface EmployeeModel {
  modelRef: string;
  label: string;
  available: boolean;
}

export type AuthClientErrorCode =
  | "AUTH_REQUIRED"
  | "LOGIN_UNAVAILABLE"
  | "LOGOUT_UNAVAILABLE"
  | "SESSION_UNAVAILABLE"
  | "SESSION_INVALID"
  | "GENERATION_UNAVAILABLE"
  | "RAG_UNAVAILABLE"
  | "RAG_NOT_CONFIGURED"
  | "FORBIDDEN"
  | "MODEL_NOT_ELIGIBLE"
  | "CONVERSATION_REF_INVALID"
  | "OVERLOADED"
  | "CAPACITY_UNAVAILABLE"
  | "DEPENDENCY_UNAVAILABLE"
  | "RATE_LIMITED";

export class AuthClientError extends Error {
  readonly code: AuthClientErrorCode;
  readonly status?: number;
  readonly detail?: string;

  constructor(code: AuthClientErrorCode, status?: number, detail?: string) {
    super(code);
    this.name = "AuthClientError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

export interface RagAnswer {
  output: string;
  citations: readonly { source: string; section: string }[];
  conversationRef: string;
}

export interface AuthClientOptions {
  baseUrl: string;
  sessionEndpoint?: string;
  generateEndpoint?: string;
  ragEndpoint?: string;
  modelsEndpoint?: string;
  adminProvidersEndpoint?: string;
  adminIngestionEndpoint?: string;
  loginPath?: string;
  logoutPath?: string;
  csrfCookieName?: string;
  csrfHeaderName?: string;
  fetcher?: typeof fetch;
  /** When true, login is opened in the system browser (Tauri desktop). */
  openExternal?: (url: string) => void;
}

export interface IngestionMeta {
  corpora: string[];
  ragProfileVersion: number;
  ragProfileDigest: `sha256:${string}`;
  chunking: { maxTokens: number; overlapTokens: number };
}

export interface IngestionJobResult {
  jobId: string;
  state: string;
  stage: string;
  generation?: string;
}

function sameOriginBase(baseUrl: string): string {
  if (baseUrl === "") return "";
  return baseUrl.replace(/\/$/, "");
}

function readErrorCode(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const error = (payload as { error?: unknown }).error;
  return typeof error === "string" ? error : undefined;
}

function readErrorReason(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const body = payload as { reason?: unknown; detail?: unknown };
  if (typeof body.reason === "string" && body.reason.trim()) return body.reason.trim();
  if (typeof body.detail === "string" && body.detail.trim()) return body.detail.trim();
  return undefined;
}

function classifyEndpointError(
  response: Response,
  payload: unknown,
  fallback: AuthClientErrorCode,
): AuthClientError {
  const errorCode = readErrorCode(payload);
  if (response.status === 401 || errorCode === "UNAUTHENTICATED") {
    return new AuthClientError("AUTH_REQUIRED", response.status);
  }
  if (response.status === 429 || errorCode === "OVERLOADED") {
    return new AuthClientError("OVERLOADED", response.status);
  }
  if (errorCode === "RATE_LIMITED") {
    return new AuthClientError("RATE_LIMITED", response.status);
  }
  if (
    errorCode === "DRAINING" ||
    errorCode === "ADMISSION_UNAVAILABLE" ||
    errorCode === "CAPACITY_UNAVAILABLE" ||
    errorCode === "CAPACITY_EXHAUSTED"
  ) {
    return new AuthClientError("CAPACITY_UNAVAILABLE", response.status);
  }
  if (errorCode === "DEPENDENCY_UNAVAILABLE") {
    return new AuthClientError("DEPENDENCY_UNAVAILABLE", response.status);
  }
  if (errorCode === "RAG_NOT_CONFIGURED") {
    return new AuthClientError("RAG_NOT_CONFIGURED", response.status);
  }
  if (errorCode === "CONVERSATION_REF_INVALID") {
    return new AuthClientError("CONVERSATION_REF_INVALID", response.status, readErrorReason(payload));
  }
  if (errorCode === "MODEL_NOT_ELIGIBLE") {
    return new AuthClientError("MODEL_NOT_ELIGIBLE", response.status, readErrorReason(payload));
  }
  if (response.status === 403 || errorCode === "FORBIDDEN") {
    return new AuthClientError("FORBIDDEN", response.status, readErrorReason(payload));
  }
  return new AuthClientError(fallback, response.status, readErrorReason(payload));
}

async function readJsonPayload(response: Response): Promise<unknown | undefined> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export function createAuthClient(options: AuthClientOptions) {
  const baseUrl = sameOriginBase(options.baseUrl);
  const sessionEndpoint = options.sessionEndpoint ?? "/api/session";
  const generateEndpoint = options.generateEndpoint ?? "/api/generate";
  const ragEndpoint = options.ragEndpoint ?? "/api/rag/ask";
  const modelsEndpoint = options.modelsEndpoint ?? "/api/models";
  const adminProvidersEndpoint = options.adminProvidersEndpoint ?? "/api/admin/providers";
  const adminIngestionEndpoint = options.adminIngestionEndpoint ?? "/api/admin/ingestion";
  const loginPath = options.loginPath ?? "/auth/login";
  const logoutPath = options.logoutPath ?? "/auth/logout";
  const csrfCookieName = options.csrfCookieName ?? "lens_csrf";
  const csrfHeaderName = options.csrfHeaderName ?? "x-lens-csrf";
  const fetcher = options.fetcher ?? fetch;

  function csrfHeaders(): Record<string, string> {
    if (typeof document === "undefined") return {};
    const prefix = `${encodeURIComponent(csrfCookieName)}=`;
    const cookie = document.cookie
      .split(";")
      .map((value) => value.trim())
      .find((value) => value.startsWith(prefix));
    if (!cookie) return {};
    try {
      return { [csrfHeaderName]: decodeURIComponent(cookie.slice(prefix.length)) };
    } catch {
      return {};
    }
  }

  async function getSession(signal?: AbortSignal): Promise<AuthSessionInfo> {
    const response = await fetcher(`${baseUrl}${sessionEndpoint}`, {
      method: "GET",
      credentials: "include",
      headers: { accept: "application/json" },
      signal,
    });
    if (!response.ok) {
      throw new AuthClientError("SESSION_UNAVAILABLE", response.status);
    }
    const payload = await readJsonPayload(response);
    if (!payload || typeof payload !== "object") {
      throw new AuthClientError("SESSION_INVALID", response.status);
    }
    return payload as AuthSessionInfo;
  }

  async function beginLogin(): Promise<void> {
    const url = `${baseUrl}${loginPath}`;
    if (options.openExternal) {
      options.openExternal(url);
      return;
    }
    try {
      const response = await fetcher(url, {
        method: "GET",
        credentials: "include",
        redirect: "manual",
        headers: { accept: "application/json" },
      });
      if (
        response.type === "opaqueredirect" ||
        (response.status >= 300 && response.status < 400) ||
        response.ok
      ) {
        window.location.assign(url);
        return;
      }
      throw new AuthClientError("LOGIN_UNAVAILABLE", response.status);
    } catch (error) {
      if (error instanceof AuthClientError) throw error;
      throw new AuthClientError("LOGIN_UNAVAILABLE");
    }
  }

  async function logout(signal?: AbortSignal): Promise<void> {
    const response = await fetcher(`${baseUrl}${logoutPath}`, {
      method: "POST",
      credentials: "include",
      headers: { accept: "application/json" },
      signal,
    });
    if (!response.ok) {
      throw new AuthClientError("LOGOUT_UNAVAILABLE", response.status);
    }
    let payload: unknown = {};
    try {
      payload = await response.json();
    } catch {
      // Non-JSON success is fine; we just won't redirect to the IdP.
    }
    // If the BFF offers an IdP end-session URL, navigate there so the IdP
    // session also ends (full single logout). localStorage isn't used; this is
    // a navigation, not a credential.
    const logoutUrl = (payload as { logoutUrl?: unknown })?.logoutUrl;
    if (typeof logoutUrl === "string" && logoutUrl) {
      if (options.openExternal) {
        options.openExternal(logoutUrl);
      } else {
        window.location.assign(logoutUrl);
      }
    }
  }

  async function generate(prompt: string, signal?: AbortSignal): Promise<string> {
    const session = await getSession(signal);
    if (!session.authenticated) {
      throw new AuthClientError("AUTH_REQUIRED");
    }
    const response = await fetcher(`${baseUrl}${generateEndpoint}`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", accept: "application/json", ...csrfHeaders() },
      body: JSON.stringify({ prompt }),
      signal,
    });
    const payload = await readJsonPayload(response);
    if (!response.ok) {
      throw classifyEndpointError(response, payload, "GENERATION_UNAVAILABLE");
    }
    if (!payload || typeof payload !== "object" || typeof (payload as { output?: unknown }).output !== "string") {
      throw new AuthClientError("GENERATION_UNAVAILABLE", response.status);
    }
    return (payload as { output: string }).output;
  }

  async function askRag(query: string, options?: { modelId?: string; conversationRef?: string; conversationCreationKey?: string; signal?: AbortSignal }): Promise<RagAnswer> {
    const signal = options?.signal;
    const session = await getSession(signal);
    if (!session.authenticated) throw new AuthClientError("AUTH_REQUIRED");

    async function postAsk(askOptions: typeof options) {
      const modelId = askOptions?.modelId;
      const response = await fetcher(`${baseUrl}${ragEndpoint}`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json", ...csrfHeaders() },
        body: JSON.stringify({
          query,
          ...(modelId ? { modelId } : {}),
          ...(askOptions?.conversationRef ? { conversationRef: askOptions.conversationRef } : {}),
          ...(askOptions?.conversationCreationKey ? { conversationCreationKey: askOptions.conversationCreationKey } : {}),
        }),
        signal,
      });
      const payload = await readJsonPayload(response);
      return { response, payload };
    }

    let { response, payload } = await postAsk(options);
    if (!response.ok) {
      const errorCode = readErrorCode(payload);
      const staleConversation =
        options?.conversationRef &&
        (errorCode === "CONVERSATION_REF_INVALID" || errorCode === "FORBIDDEN");
      if (response.status === 403 && staleConversation) {
        ({ response, payload } = await postAsk({ ...options, conversationRef: undefined }));
      }
    }
    if (!response.ok) {
      throw classifyEndpointError(response, payload, "RAG_UNAVAILABLE");
    }
    if (!payload || typeof payload !== "object" || typeof (payload as { output?: unknown }).output !== "string" || !Array.isArray((payload as { citations?: unknown }).citations) || typeof (payload as { conversationRef?: unknown }).conversationRef !== "string") {
      throw new AuthClientError("RAG_UNAVAILABLE", response.status);
    }
    const result = payload as { output: string; citations: unknown[]; conversationRef: string };
    if (result.citations.some((citation) => !citation || typeof citation !== "object" || typeof (citation as { source?: unknown }).source !== "string" || typeof (citation as { section?: unknown }).section !== "string")) {
      throw new AuthClientError("RAG_UNAVAILABLE", response.status);
    }
    return {
      output: result.output,
      conversationRef: result.conversationRef,
      citations: result.citations.map((citation) => ({
        source: (citation as { source: string }).source,
        section: (citation as { section: string }).section,
      })),
    };
  }

  async function listModels(signal?: AbortSignal): Promise<readonly EmployeeModel[]> {
    const session = await getSession(signal);
    if (!session.authenticated) throw new AuthClientError("AUTH_REQUIRED");
    const response = await fetcher(`${baseUrl}${modelsEndpoint}`, {
      method: "GET",
      credentials: "include",
      headers: { accept: "application/json" },
      signal,
    });
    const payload = await readJsonPayload(response);
    if (!response.ok) throw classifyEndpointError(response, payload, "DEPENDENCY_UNAVAILABLE");
    const models = payload && typeof payload === "object" ? (payload as { models?: unknown }).models : undefined;
    if (!Array.isArray(models)) throw new AuthClientError("DEPENDENCY_UNAVAILABLE", response.status);
    return models.filter((row): row is EmployeeModel => {
      if (!row || typeof row !== "object") return false;
      const model = row as EmployeeModel;
      return typeof model.modelRef === "string" && typeof model.label === "string" && typeof model.available === "boolean";
    });
  }

  async function onboardProvider(input: {
    adapterType?: "openai-compatible";
    baseUrl: string;
    apiKey: string;
    tlsWorkloadRef: string;
    allowedModels: string[];
    capabilities: Array<"generate" | "embed" | "stream">;
    timeoutMs: number;
    maxConcurrency: number;
    idempotencyKey: string;
  }): Promise<{ id: string; status: string }> {
    const session = await getSession();
    if (!session.authenticated) throw new AuthClientError("AUTH_REQUIRED");
    const response = await fetcher(`${baseUrl}${adminProvidersEndpoint}`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", accept: "application/json", ...csrfHeaders() },
      body: JSON.stringify({ ...input, adapterType: input.adapterType ?? "openai-compatible" }),
    });
    const payload = await readJsonPayload(response);
    if (!response.ok) {
      throw new AuthClientError("DEPENDENCY_UNAVAILABLE", response.status, readErrorCode(payload));
    }
    if (!payload || typeof payload !== "object" || typeof (payload as { id?: unknown }).id !== "string") {
      throw new AuthClientError("DEPENDENCY_UNAVAILABLE", response.status);
    }
    const body = payload as Record<string, unknown>;
    if ("apiKey" in body || "secretRef" in body || "baseUrl" in body) {
      throw new AuthClientError("DEPENDENCY_UNAVAILABLE", response.status);
    }
    return { id: String(body.id), status: String(body.status ?? "") };
  }

  async function getIngestionMeta(signal?: AbortSignal): Promise<IngestionMeta> {
    const session = await getSession(signal);
    if (!session.authenticated) throw new AuthClientError("AUTH_REQUIRED");
    const response = await fetcher(`${baseUrl}${adminIngestionEndpoint}/meta`, {
      method: "GET",
      credentials: "include",
      headers: { accept: "application/json" },
      signal,
    });
    const payload = await readJsonPayload(response);
    if (!response.ok) {
      throw new AuthClientError("DEPENDENCY_UNAVAILABLE", response.status, readErrorCode(payload));
    }
    if (!payload || typeof payload !== "object") {
      throw new AuthClientError("DEPENDENCY_UNAVAILABLE", response.status);
    }
    const body = payload as Record<string, unknown>;
    if (!Array.isArray(body.corpora) || typeof body.ragProfileVersion !== "number" || typeof body.ragProfileDigest !== "string") {
      throw new AuthClientError("DEPENDENCY_UNAVAILABLE", response.status);
    }
    const chunking = body.chunking && typeof body.chunking === "object" ? body.chunking as { maxTokens?: unknown; overlapTokens?: unknown } : {};
    return {
      corpora: body.corpora.filter((value): value is string => typeof value === "string"),
      ragProfileVersion: body.ragProfileVersion,
      ragProfileDigest: body.ragProfileDigest as `sha256:${string}`,
      chunking: {
        maxTokens: typeof chunking.maxTokens === "number" ? chunking.maxTokens : 400,
        overlapTokens: typeof chunking.overlapTokens === "number" ? chunking.overlapTokens : 40,
      },
    };
  }

  async function submitIngestionJob(
    corpusRef: string,
    body: Record<string, unknown>,
  ): Promise<IngestionJobResult> {
    const session = await getSession();
    if (!session.authenticated) throw new AuthClientError("AUTH_REQUIRED");
    const response = await fetcher(`${baseUrl}${adminIngestionEndpoint}/corpora/${encodeURIComponent(corpusRef)}/jobs`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", accept: "application/json", ...csrfHeaders() },
      body: JSON.stringify(body),
    });
    const payload = await readJsonPayload(response);
    if (!response.ok) {
      throw new AuthClientError("DEPENDENCY_UNAVAILABLE", response.status, readErrorReason(payload));
    }
    if (!payload || typeof payload !== "object" || typeof (payload as { jobId?: unknown }).jobId !== "string") {
      throw new AuthClientError("DEPENDENCY_UNAVAILABLE", response.status);
    }
    const result = payload as Record<string, unknown>;
    return {
      jobId: String(result.jobId),
      state: String(result.state ?? ""),
      stage: String(result.stage ?? ""),
      generation: typeof result.generation === "string" ? result.generation : undefined,
    };
  }

  return {
    getSession,
    beginLogin,
    logout,
    generate,
    askRag,
    listModels,
    onboardProvider,
    getIngestionMeta,
    submitIngestionJob,
  };
}

export type AuthClient = ReturnType<typeof createAuthClient>;
