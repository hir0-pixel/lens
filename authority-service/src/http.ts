import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  AuthorityConflictError,
  AuthorityNotFoundError,
  AuthorityService,
  AuthorityValidationError,
} from "./service";
import type { ModelUseAuthorityPort } from "../../services/pdp/ModelUseAuthority";
import { ModelUseAuthorityError } from "../../services/pdp/ModelUseAuthority";

const MAX_BODY_BYTES = 256 * 1024;

export interface AuthorityHttpOptions {
  workloadToken: string;
  service: AuthorityService;
  maxActiveRequests?: number;
  maxBodyBytes?: number;
  maxHeaderBytes?: number;
  drainTimeoutMs?: number;
  isStoreReady: () => boolean;
  isGovernanceReady?: () => Promise<boolean>;
  isReleaseReady?: () => Promise<boolean>;
  modelUseAuthority?: ModelUseAuthorityPort;
}

export interface AuthorityHttp {
  server: Server;
  listen(port: number, host: string): Promise<void>;
  close(): Promise<void>;
  activeRequests(): number;
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function headerBytes(req: IncomingMessage): number {
  return Object.entries(req.headers).reduce((total, [key, value]) => total + key.length + String(value).length, 0);
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
        chunks.length = 0;
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

function respond(res: ServerResponse, status: number, payload: Record<string, unknown>, draining: boolean): void {
  if (res.destroyed || res.writableEnded) return;
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    connection: draining ? "close" : "keep-alive",
  });
  res.end(body);
}

function record(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("INVALID_JSON");
  return payload as Record<string, unknown>;
}

type Route = (body: Record<string, unknown>, service: AuthorityService) => Promise<Record<string, unknown>>;

const routes: Record<string, Route> = {
  "/v1/generation-context-fences/revalidate": async (body, service) => {
      const result = await service.revalidate({
      requestId: body.request_id as string,
      turnId: body.turn_id as string,
      subjectRef: body.subject_ref as string,
      deviceRef: body.device_ref as string,
      sessionRef: body.session_ref as string,
      contextDigest: body.context_digest as string,
      manifestExpiresAt: body.manifest_expires_at as number,
      boundary: body.boundary as "generation_start" | "tool_call_boundary",
      resourceRefs: (body.resource_refs as string[]) ?? [],
      indexGeneration: body.index_generation as string,
      ...(typeof body.tool_call_ref === "string" ? { toolCallRef: body.tool_call_ref } : {}),
    });
    return {
      request_id: result.requestId,
      turn_id: result.turnId,
      boundary: result.boundary,
      fence_ref: result.fenceRef,
      context_digest: result.contextDigest,
      expires_at: result.expiresAt,
      checked_at: result.checkedAt,
    };
  },
  "/v1/audit/admissions": async (body, service) => {
    if (!Number.isSafeInteger(body.rag_profile_version) || (body.rag_profile_version as number) < 0) {
      throw new AuthorityValidationError("rag_profile_version must be a non-negative integer.");
    }
    if (typeof body.rag_profile_digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(body.rag_profile_digest)) {
      throw new AuthorityValidationError("rag_profile_digest must be a sha256 digest.");
    }
    const routeOverride = body.route_override as Record<string, unknown> | undefined;
    const result = await service.admit({
      kind: body.kind as "generation" | "release" | "route_override",
      requestId: body.request_id as string,
      turnId: body.turn_id as string,
      inputDigest: body.input_digest as string,
      ragProfileVersion: body.rag_profile_version as number,
      ragProfileDigest: body.rag_profile_digest as string,
      ...(routeOverride ? {
        routeOverride: {
          attemptedRoute: routeOverride.attempted_route as string,
          attemptedReasonCode: routeOverride.attempted_reason_code as string,
          attemptedConfidenceBucket: routeOverride.attempted_confidence_bucket as string,
          ...(typeof routeOverride.attempted_profile_selector === "string" ? { attemptedProfileSelector: routeOverride.attempted_profile_selector } : {}),
          effectiveRoute: routeOverride.effective_route as string,
          ...(typeof routeOverride.effective_profile_selector === "string" ? { effectiveProfileSelector: routeOverride.effective_profile_selector } : {}),
          groundingRequired: routeOverride.grounding_required as boolean,
          routePolicyRevision: routeOverride.route_policy_revision as number,
          routePolicyDigest: routeOverride.route_policy_digest as string,
          allowedProfileSetDigest: routeOverride.allowed_profile_set_digest as string,
          enforcementOverride: routeOverride.enforcement_override as boolean,
          overrideReason: routeOverride.override_reason as string,
        },
      } : {}),
    });
    return {
      kind: result.kind,
      request_id: result.requestId,
      turn_id: result.turnId,
      input_digest: result.inputDigest,
      rag_profile_version: result.ragProfileVersion,
      rag_profile_digest: result.ragProfileDigest,
      receipt_digest: result.receiptDigest,
      ...(result.routeOverride ? {
        route_override: {
          attempted_route: result.routeOverride.attemptedRoute,
          attempted_reason_code: result.routeOverride.attemptedReasonCode,
          attempted_confidence_bucket: result.routeOverride.attemptedConfidenceBucket,
          ...(result.routeOverride.attemptedProfileSelector !== undefined ? { attempted_profile_selector: result.routeOverride.attemptedProfileSelector } : {}),
          effective_route: result.routeOverride.effectiveRoute,
          ...(result.routeOverride.effectiveProfileSelector !== undefined ? { effective_profile_selector: result.routeOverride.effectiveProfileSelector } : {}),
          grounding_required: result.routeOverride.groundingRequired,
          route_policy_revision: result.routeOverride.routePolicyRevision,
          route_policy_digest: result.routeOverride.routePolicyDigest,
          allowed_profile_set_digest: result.routeOverride.allowedProfileSetDigest,
          enforcement_override: result.routeOverride.enforcementOverride,
          override_reason: result.routeOverride.overrideReason,
        },
      } : {}),
    };
  },
  "/v1/output-guard/inspect": async (body, service) => {
    const result = await service.inspect({
      requestId: body.request_id as string,
      subjectRef: body.subject_ref as string,
      output: body.output as string,
      outputDigest: body.output_digest as string,
      sourceClassifications: (body.source_classifications as string[]) ?? [],
    });
    if (!result.allowed) {
      return {
        request_id: result.requestId,
        output_digest: result.outputDigest,
        allowed: false,
        guard_receipt: result.guardReceipt,
        reason: result.reason,
      };
    }
    return {
      request_id: result.requestId,
      output_digest: result.outputDigest,
      allowed: true,
      derived_classification_ref: result.derivedClassificationRef,
      guard_receipt: result.guardReceipt,
    };
  },
  "/v1/output-blobs": async (body, service) => {
    const result = await service.putBlob({
      requestId: body.request_id as string,
      turnId: body.turn_id as string,
      output: body.output as string,
      outputDigest: body.output_digest as string,
      classificationRef: body.classification_ref as string,
      guardReceipt: body.guard_receipt as string,
    });
    return {
      request_id: result.requestId,
      turn_id: result.turnId,
      output_ref: result.outputRef,
      output_digest: result.outputDigest,
      commit_proof: result.commitProof,
    };
  },
  "/v1/output-blobs/verify": async (body, service) => {
    const result = await service.verifyBlob({
      outputRef: body.output_ref as string,
      outputDigest: body.output_digest as string,
    });
    return { output_ref: result.outputRef, output_digest: result.outputDigest, verified: result.verified };
  },
  "/v1/output-blobs/repair": async (body, service) => {
    const result = await service.repairDanglingOutput({
      outputRef: body.output_ref as string,
      outputDigest: body.output_digest as string,
    });
    return { output_ref: result.outputRef, output_digest: result.outputDigest, status: result.status };
  },
  "/v1/turn-state/terminal-commits": async (body, service) => {
    const result = await service.commitTerminal({
      requestId: body.request_id as string,
      turnId: body.turn_id as string,
      outputRef: body.output_ref as string,
      outputDigest: body.output_digest as string,
      releaseFence: body.release_fence as string,
      releaseAuditReceipt: body.release_audit_receipt as string,
    });
    return {
      request_id: result.requestId,
      turn_id: result.turnId,
      output_ref: result.outputRef,
      output_digest: result.outputDigest,
      release_fence: result.releaseFence,
      committed: true,
    };
  },
  "/v1/turn-state/failures": async (body, service) => {
    await service.markFailed({
      requestId: body.request_id as string,
      turnId: body.turn_id as string,
      code: body.code as string,
    });
    return { ok: true };
  },
  "/v1/disclosures/reservations": async (body, service) => {
    const terminalReceipt = (body.terminal_receipt ?? {}) as Record<string, unknown>;
    const result = await service.reserve({
      requestId: body.request_id as string,
      subjectRef: body.subject_ref as string,
      deviceRef: body.device_ref as string,
      applicationRef: body.application_ref as string,
      purposeRef: body.purpose_ref as string,
      outputRef: body.output_ref as string,
      outputDigest: body.output_digest as string,
      classificationRef: body.classification_ref as string,
      sourceClassifications: (body.source_classifications as string[]) ?? [],
      resourceSetDigest: body.resource_set_digest as `sha256:${string}`,
      lineageDigest: body.lineage_digest as `sha256:${string}`,
      units: body.units as number,
      ceiling: body.ceiling as number,
      terminalReceipt: {
        runRef: terminalReceipt.run_ref as string,
        finalCounterDigest: terminalReceipt.final_counter_digest as `sha256:${string}`,
        terminal: terminalReceipt.terminal as boolean,
        pendingWork: terminalReceipt.pending_work as boolean,
      },
      expiresAt: body.expires_at as number,
    });
    return {
      request_id: result.requestId,
      output_ref: result.outputRef,
      output_digest: result.outputDigest,
      classification_ref: result.classificationRef,
      reservation_ref: result.reservationRef,
    };
  },
  "/v1/disclosures/commits": async (body, service) => {
    const result = await service.commitReservation({
      reservationRef: body.reservation_ref as string,
      outputRef: body.output_ref as string,
      outputDigest: body.output_digest as string,
      releaseFence: body.release_fence as string,
    });
    return {
      reservation_ref: result.reservationRef,
      output_ref: result.outputRef,
      output_digest: result.outputDigest,
      release_fence: result.releaseFence,
      committed: true,
    };
  },
  "/v1/result-authorization/authorize": async (body, service) => {
    const result = await service.authorize({
      requestId: body.request_id as string,
      subjectRef: body.subject_ref as string,
      outputRef: body.output_ref as string,
      outputDigest: body.output_digest as string,
      classificationRef: body.classification_ref as string,
      disclosureReservationRef: body.disclosure_reservation_ref as string,
    });
    return {
      request_id: result.requestId,
      output_ref: result.outputRef,
      output_digest: result.outputDigest,
      classification_ref: result.classificationRef,
      disclosure_reservation_ref: result.disclosureReservationRef,
      release_fence: result.releaseFence,
      obligations: result.obligations,
    };
  },
};

export function createAuthorityHttp(options: AuthorityHttpOptions): AuthorityHttp {
  const {
    workloadToken,
    service,
    maxActiveRequests = 64,
    maxBodyBytes = MAX_BODY_BYTES,
    maxHeaderBytes = 8 * 1024,
    drainTimeoutMs = 15_000,
    isStoreReady,
    isGovernanceReady = async () => true,
    isReleaseReady = async () => true,
    modelUseAuthority,
  } = options;
  if (workloadToken.length < 32) throw new Error("workloadToken must contain at least 32 characters.");
  if (maxActiveRequests < 1) throw new Error("maxActiveRequests must be at least 1.");

  let active = 0;
  let draining = false;
  let drainFinish: (() => void) | undefined;

  const server = createServer({ maxHeaderSize: maxHeaderBytes, headersTimeout: 10_000, requestTimeout: 70_000 }, async (req, res) => {
    if (headerBytes(req) > maxHeaderBytes) {
      respond(res, 431, { error: "HEADER_TOO_LARGE" }, draining);
      return;
    }
    if (req.method === "GET" && req.url === "/livez") {
      respond(res, 200, { ok: true }, draining);
      return;
    }
    if (req.method === "GET" && req.url === "/readyz") {
      const ready = !draining && isStoreReady() && await isGovernanceReady() && await isReleaseReady();
      respond(res, ready ? 200 : 503, { ok: ready }, draining);
      return;
    }
    const extraRoutes: Record<string, Route> = modelUseAuthority ? {
      "/v1/model-use/authorize-generate": async (body) => {
        const receipt = await modelUseAuthority.authorizeGenerate({
          requestId: String(body.request_id),
          requestDigest: body.request_digest as `sha256:${string}`,
          subjectRef: String(body.subject_ref),
          deviceRef: String(body.device_ref),
          sessionRef: String(body.session_ref),
          applicationRef: String(body.application_ref),
          workspaceRef: String(body.workspace_ref),
          purposeRef: String(body.purpose_ref),
          requestClass: String(body.request_class),
          deadlineAt: Number(body.deadline_at),
        }, new AbortController().signal);
        return receipt as unknown as Record<string, unknown>;
      },
      "/v1/model-use/authorize-model-use": async (body) => {
        const receipt = await modelUseAuthority.authorizeModelUse({
          requestId: String(body.request_id),
          turnId: String(body.turn_id),
          stepId: String(body.step_id),
          stepClass: body.step_class as never,
          requestDigest: body.request_digest as `sha256:${string}`,
          modelRef: String(body.model_ref),
          artifactDigest: body.artifact_digest as `sha256:${string}`,
          capability: String(body.capability),
          subjectRef: String(body.subject_ref),
          applicationRef: String(body.application_ref),
          workspaceRef: String(body.workspace_ref),
          purposeRef: String(body.purpose_ref),
          requestClass: String(body.request_class),
          deadlineAt: Number(body.deadline_at),
        }, new AbortController().signal);
        return receipt as unknown as Record<string, unknown>;
      },
    } : {};
    const route = req.method === "POST" && req.url ? (routes[req.url] ?? extraRoutes[req.url]) : undefined;
    if (!route) {
      respond(res, 404, { error: "NOT_FOUND" }, draining);
      return;
    }
    const token = req.headers["x-lens-authority-token"];
    if (typeof token !== "string" || !safeEqual(token, workloadToken)) {
      respond(res, 401, { error: "UNAUTHENTICATED" }, draining);
      return;
    }
    if (draining || !isStoreReady() || !(await isGovernanceReady()) || !(await isReleaseReady())) {
      respond(res, 503, { error: "DRAINING" }, draining);
      return;
    }
    if (active >= maxActiveRequests) {
      respond(res, 429, { error: "OVERLOADED", retryable: true }, draining);
      return;
    }
    if (req.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
      respond(res, 415, { error: "UNSUPPORTED_MEDIA_TYPE" }, draining);
      return;
    }
    const declaredLength = Number(req.headers["content-length"] ?? "0");
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 0 || declaredLength > maxBodyBytes) {
      respond(res, 413, { error: "PAYLOAD_TOO_LARGE" }, draining);
      return;
    }

    active += 1;
    void readJsonBody(req, maxBodyBytes)
      .then((payload) => route(record(payload), service))
      .then((result) => {
        respond(res, 200, result, draining);
      })
      .catch((error: Error) => {
        if (error.message === "PAYLOAD_TOO_LARGE") respond(res, 413, { error: "PAYLOAD_TOO_LARGE" }, draining);
        else if (error.message === "INVALID_JSON") respond(res, 400, { error: "INVALID_ARGUMENT" }, draining);
        else if (error instanceof AuthorityValidationError) respond(res, 400, { error: "INVALID_ARGUMENT", message: error.message }, draining);
        else if (error instanceof AuthorityConflictError) respond(res, 409, { error: "CONFLICT", message: error.message }, draining);
        else if (error instanceof AuthorityNotFoundError) respond(res, 404, { error: "NOT_FOUND", message: error.message }, draining);
        else if (error instanceof ModelUseAuthorityError) respond(res, error.code === "MODEL_INELIGIBLE" || error.code === "SUBJECT_INACTIVE" || error.code === "DEVICE_NONCOMPLIANT" ? 403 : 503, { error: error.code }, draining);
        else respond(res, 500, { error: "INTERNAL" }, draining);
      })
      .finally(() => {
        active -= 1;
        if (draining && active === 0 && drainFinish) drainFinish();
      });
  });

  return {
    server,
    listen: (port, host) => new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => resolve());
    }),
    close: () => new Promise<void>((resolve) => {
      draining = true;
      const force = setTimeout(() => {
        server.closeAllConnections();
        server.close(() => resolve());
      }, drainTimeoutMs);
      drainFinish = () => {
        clearTimeout(force);
        server.close(() => resolve());
      };
      if (active === 0) drainFinish();
    }),
    activeRequests: () => active,
  };
}
