import { randomUUID } from "node:crypto";
import type { HookInvocation, Hooks } from "@earendil-works/pi-agent-core/node";
import {
  createAssistantMessageEventStream,
  createProvider,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type ToolCall,
  type Usage,
} from "@earendil-works/pi-ai";
import { InferenceAdapter } from "../inference-adapter/InferenceAdapter";
import type { ModelGateway, ModelGatewayChatDispatchInput, RuntimePort } from "../model-gateway/ModelGateway";
import { createModelProviderAdapter } from "../model-provider/createModelProviderAdapter";
import type { ProviderEndpointConfig } from "../model-provider/ProviderAdapter";
import type { SecretStore } from "../secrets/SecretStore";
import { CONTEXT_BLOCK_REASON, CONTEXT_BLOCK_SYSTEM_PROMPT } from "./contextBinding";

const PROVIDER_ID = "lens-model-gateway";
const API = "lens-chat";
const ADMISSION_KEY = "lens.model_admission";
const EMPTY_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

type DispatchBase = Omit<ModelGatewayChatDispatchInput, "modelRef" | "messages" | "tools">;
type FetchPort = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface AgentModelSelection {
  modelRef: string;
}

export interface LensAgentProviderOptions {
  selection: AgentModelSelection;
  gateway: Pick<ModelGateway, "generateChat">;
  prepareDispatch(event: HookInvocation<"before_request">): Promise<DispatchBase> | DispatchBase;
  environment?: NodeJS.ProcessEnv;
}

export interface InProcessLensAgentProviderOptions extends Omit<LensAgentProviderOptions, "gateway"> {
  providerConfig: ProviderEndpointConfig;
  createGateway(runtime: RuntimePort): ModelGateway;
  fetcher?: FetchPort;
  secrets?: SecretStore;
}

export function assertAgentEnvironment(environment: NodeJS.ProcessEnv): void {
  const forbidden = Object.keys(environment).find((name) =>
    name === "SECRET_STORE_KEY"
    || name === "CATALOG_WORKLOAD_TOKEN"
    || name.endsWith("_API_KEY")
  );
  if (forbidden) throw new Error("Agent process environment contains provider credentials.");
}

function assertSelection(selection: AgentModelSelection): void {
  const record = selection as unknown as Record<string, unknown>;
  if (typeof record.modelRef !== "string" || record.modelRef.length === 0) throw new Error("A catalog modelRef is required.");
  if (["apiKey", "baseUrl", "provider"].some((key) => key in record)) {
    throw new Error("Agent model selection accepts only modelRef.");
  }
}

function textContent(content: Context["messages"][number]["content"]): string {
  if (typeof content === "string") return content;
  if (content.some((part) => part.type !== "text")) throw new Error("Agent chat transport supports text content only.");
  return content.map((part) => part.type === "text" ? part.text : "").join("");
}

function chatMessages(context: Context) {
  const messages: ModelGatewayChatDispatchInput["messages"][number][] = [];
  if (context.systemPrompt) messages.push({ role: "system", content: context.systemPrompt });
  for (const message of context.messages) {
    if (message.role === "user") {
      messages.push({ role: "user", content: textContent(message.content) });
      continue;
    }
    if (message.role === "toolResult") {
      messages.push({ role: "tool", content: textContent(message.content), toolCallId: message.toolCallId });
      continue;
    }
    const calls = message.content.filter((part): part is ToolCall => part.type === "toolCall");
    messages.push({
      role: "assistant",
      content: message.content.filter((part) => part.type === "text").map((part) => part.text).join(""),
      ...(calls.length > 0 ? { toolCalls: calls.map((call) => ({
        id: call.id,
        name: call.name,
        arguments: JSON.stringify(call.arguments),
      })) } : {}),
    });
  }
  return messages;
}

function assistant(model: Model<typeof API>, stopReason: AssistantMessage["stopReason"] = "pending"): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: structuredClone(EMPTY_USAGE),
    stopReason,
    timestamp: Date.now(),
  };
}

function errorStream(model: Model<typeof API>, message: string): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const error = assistant(model, "error");
  error.errorMessage = message;
  stream.push({ type: "error", reason: "error", error });
  return stream;
}

export function createLensAgentProvider(options: LensAgentProviderOptions) {
  assertSelection(options.selection);
  assertAgentEnvironment(options.environment ?? process.env);
  const pending = new Map<string, DispatchBase>();
  const model: Model<typeof API> = {
    id: options.selection.modelRef,
    name: options.selection.modelRef,
    api: API,
    provider: PROVIDER_ID,
    baseUrl: "",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 16_384,
  };

  const stream = (requestModel: Model<typeof API>, context: Context, streamOptions?: { signal?: AbortSignal; metadata?: Record<string, unknown> }): AssistantMessageEventStream => {
    if (context.systemPrompt === CONTEXT_BLOCK_SYSTEM_PROMPT) return errorStream(requestModel, CONTEXT_BLOCK_REASON);
    const admission = streamOptions?.metadata?.[ADMISSION_KEY];
    if (requestModel.id !== model.id || typeof admission !== "string") return errorStream(requestModel, "Model request was not admitted.");
    const dispatch = pending.get(admission);
    pending.delete(admission);
    if (!dispatch) return errorStream(requestModel, "Model request was not admitted.");

    const events = createAssistantMessageEventStream();
    void (async () => {
      const partial = assistant(requestModel);
      events.push({ type: "start", partial });
      try {
        const result = await options.gateway.generateChat({
          ...dispatch,
          modelRef: model.id,
          messages: chatMessages(context),
          tools: (context.tools ?? []).map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          })),
        }, streamOptions?.signal ?? new AbortController().signal);

        let textIndex: number | undefined;
        const calls = new Map<number, { contentIndex: number; id: string; name: string; arguments: string }>();
        for (const delta of result.deltas) {
          if (delta.type === "text") {
            if (textIndex === undefined) {
              textIndex = partial.content.length;
              partial.content.push({ type: "text", text: "" });
              events.push({ type: "text_start", contentIndex: textIndex, partial });
            }
            const content = partial.content[textIndex];
            if (content?.type !== "text") throw new Error("Invalid text stream state.");
            content.text += delta.text;
            events.push({ type: "text_delta", contentIndex: textIndex, delta: delta.text, partial });
            continue;
          }
          let call = calls.get(delta.index);
          if (!call) {
            call = { contentIndex: partial.content.length, id: "", name: "", arguments: "" };
            calls.set(delta.index, call);
            partial.content.push({ type: "toolCall", id: "", name: "", arguments: {} });
            events.push({ type: "toolcall_start", contentIndex: call.contentIndex, partial });
          }
          if (delta.id) call.id = delta.id;
          if (delta.name) call.name += delta.name;
          if (delta.argumentsDelta) {
            call.arguments += delta.argumentsDelta;
            events.push({ type: "toolcall_delta", contentIndex: call.contentIndex, delta: delta.argumentsDelta, partial });
          }
        }

        if (textIndex !== undefined) {
          const content = partial.content[textIndex];
          if (content?.type === "text") events.push({ type: "text_end", contentIndex: textIndex, content: content.text, partial });
        }
        for (const call of calls.values()) {
          const content = partial.content[call.contentIndex];
          if (content?.type !== "toolCall" || !call.id || !call.name) throw new Error("Incomplete tool call.");
          content.id = call.id;
          content.name = call.name;
          content.arguments = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
          events.push({ type: "toolcall_end", contentIndex: call.contentIndex, toolCall: content, partial });
        }
        partial.stopReason = calls.size > 0 ? "toolUse" : "stop";
        partial.usage.output = result.receipt.measuredUnits;
        partial.usage.totalTokens = result.receipt.measuredUnits;
        events.push({ type: "done", reason: partial.stopReason, message: partial });
      } catch {
        partial.stopReason = streamOptions?.signal?.aborted ? "aborted" : "error";
        partial.errorMessage = partial.stopReason === "aborted" ? "Model request cancelled." : "Model request failed.";
        events.push({ type: "error", reason: partial.stopReason, error: partial });
      }
    })();
    return events;
  };

  const provider = createProvider({
    id: PROVIDER_ID,
    auth: { apiKey: { name: "Lens model gateway", resolve: async () => ({ auth: {} }) } },
    models: [model],
    api: { stream, streamSimple: stream },
  });

  return {
    provider,
    model,
    bind(harness: { hooks: Hooks }): () => void {
      return harness.hooks.on("before_request", async (event) => {
        if (event.model.provider !== PROVIDER_ID) return undefined;
        const admission = randomUUID();
        const dispatch = await options.prepareDispatch(event);
        pending.set(admission, dispatch);
        return { streamOptions: { metadata: { [ADMISSION_KEY]: admission } } };
      });
    },
  };
}

export function createInProcessLensAgentProvider(options: InProcessLensAgentProviderOptions) {
  const adapter = createModelProviderAdapter(options.providerConfig, options.fetcher, options.secrets);
  if (!adapter.generateChatStream) throw new Error("Agent mode requires an openai-compatible chat adapter.");
  const runtime = new InferenceAdapter(adapter);
  return createLensAgentProvider({
    selection: options.selection,
    gateway: options.createGateway(runtime),
    prepareDispatch: options.prepareDispatch,
    environment: options.environment,
  });
}
