import { createHash } from "node:crypto";
import type { AgentHarnessTool } from "@earendil-works/pi-agent-core/node";
import { Type } from "typebox";
import type { RetrievalRequest, RetrievalResult } from "../../libs/rag-contracts";
import {
  computeCompanyRagProfileDigest,
  type CompanyRagProfile,
} from "../rag-profile/companyRagProfile";
import type { ToolCatalogEntry } from "../agent-runtime/AgentRuntime";
import type { CorpusToolDetails, CorpusToolSource } from "./corpusToolContract";

const DEFAULT_MAX_OUTPUT_BYTES = 16 * 1024;
const DEFAULT_CANDIDATE_LIMIT = 20;
const DATA_FLOW = "request.subjectRef->retrieval.subject_ref;retrieval.sources.text->bounded-content;metadata->details";
const searchSchema = Type.Object({ query: Type.String({ minLength: 1, maxLength: 4_096 }) }, { additionalProperties: false });

function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export const searchCorpusCatalogEntry: ToolCatalogEntry = Object.freeze({
  toolId: "search_corpus",
  version: "1",
  targetProfileDigest: sha256("company-rag-profile"),
  risk: "read",
  requiresApproval: false,
  idempotentReplay: true,
  schemaDigest: sha256(JSON.stringify(searchSchema)),
  dataFlowProfileDigest: sha256(DATA_FLOW),
});

export interface CorpusRetrievalPort {
  retrieve(request: RetrievalRequest, signal: AbortSignal): Promise<RetrievalResult>;
}

export interface CorpusToolScope {
  requestId: string;
  turnId: string;
  subjectRef: string;
  sessionRef: string;
  deviceRef: string;
  purposeRef: string;
  deadlineAt: number;
}

export interface CreateSearchCorpusToolOptions {
  retrieval: CorpusRetrievalPort;
  profile: CompanyRagProfile;
  profileSelector: string;
  scope: CorpusToolScope;
  maxOutputBytes?: number;
  candidateLimit?: number;
}

export function resolveSearchCorpusIntent(profile: CompanyRagProfile, profileSelector: string) {
  const mapping = profile.retrievalProfiles[profileSelector];
  if (!mapping) throw new Error("Search profile is unavailable.");
  return { action: "agent.tool.search_corpus", resourceRefs: [mapping.corpusRef] } as const;
}

function sourceDetails(result: Extract<RetrievalResult, { status: "context" }>): CorpusToolSource[] {
  return result.sources.map((source) => ({
    documentVersionRef: source.document_version_ref,
    chunkRef: source.chunk_ref,
    contentDigest: source.content_digest,
    citationAnchor: source.citation_anchor,
    classificationRef: source.classification_ref,
  }));
}

function boundedExcerpts(result: Extract<RetrievalResult, { status: "context" }>, maxBytes: number): string {
  let output = "";
  for (const source of result.sources) {
    const prefix = `[${source.document_version_ref} ${source.citation_anchor}]\n`;
    const remaining = maxBytes - Buffer.byteLength(output + prefix + "\n", "utf8");
    if (remaining <= 0) break;
    let excerpt = Buffer.from(source.text, "utf8").subarray(0, remaining).toString("utf8");
    while (Buffer.byteLength(excerpt, "utf8") > remaining) excerpt = excerpt.slice(0, -1);
    output += `${prefix}${excerpt}\n`;
    if (Buffer.byteLength(output, "utf8") >= maxBytes) break;
  }
  return output.trimEnd();
}

export function createSearchCorpusTool(
  options: CreateSearchCorpusToolOptions,
): AgentHarnessTool<undefined, typeof searchSchema, CorpusToolDetails> {
  const mapping = options.profile.retrievalProfiles[options.profileSelector];
  if (!mapping) throw new Error("Search profile is unavailable.");
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1) throw new Error("Search output limit is invalid.");

  return {
    name: "search_corpus",
    label: "Search corpus",
    description: "Search company documents available to the requesting employee.",
    parameters: searchSchema,
    replay: "safe",
    async execute(_toolCallId, input, _onUpdate, _toolContext, _invocation, context) {
      const signal = context.abortSignal ?? new AbortController().signal;
      const request: RetrievalRequest = {
        request_id: options.scope.requestId,
        turn_id: options.scope.turnId,
        caller_workload_ref: "ai-orchestrator",
        subject_ref: options.scope.subjectRef,
        session_ref: options.scope.sessionRef,
        device_ref: options.scope.deviceRef,
        application_id: "lens-employee-client",
        query_digest: sha256(input.query),
        query_text: input.query,
        purpose_ref: options.scope.purposeRef,
        retrieval_class: "enterprise-grounded",
        corpus_ref: mapping.corpusRef,
        mode: mapping.mode,
        profile_version: options.profile.profileVersion,
        profile_digest: computeCompanyRagProfileDigest(options.profile),
        candidate_limit: options.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT,
        deadline_at: options.scope.deadlineAt,
        cancellation: signal.aborted,
        bulkhead: "interactive",
        visibility_minimum: 0,
      };
      const result = await options.retrieval.retrieve(request, signal);
      if (result.status === "denied_policy") throw new Error("Not permitted");
      if (result.status === "failed_downstream") throw new Error("Search unavailable");
      if (result.status === "no_context") {
        return {
          content: [{ type: "text", text: "No matching documents." }],
          details: { corpusRef: mapping.corpusRef, resourceRefs: [], sources: [] },
        };
      }
      const sources = sourceDetails(result);
      return {
        content: [{ type: "text", text: boundedExcerpts(result, maxOutputBytes) }],
        details: {
          corpusRef: mapping.corpusRef,
          resourceRefs: sources.map((source) => source.documentVersionRef),
          sources,
        },
      };
    },
  };
}
