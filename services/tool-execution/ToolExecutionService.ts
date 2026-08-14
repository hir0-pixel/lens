export type ToolState = "SUCCEEDED" | "AWAITING_APPROVAL" | "OUTCOME_UNKNOWN" | "DENIED";
export class ToolExecutionError extends Error { constructor(readonly code: "CONFLICT" | "FORBIDDEN" | "DEPENDENCY_UNAVAILABLE") { super(code); } }
export interface ToolCatalogEntry { name: string; version: string; targetRef: string; action: string; risk: "read" | "write"; requiresApproval: boolean; externalCapable: boolean; }
export interface CredentialBroker { issue(input: { subjectRef: string; targetRef: string; action: string; executionFence: string }): Promise<{ credentialRef: string }>; }
export interface Sandbox { dispatch(input: { targetRef: string; action: string; credentialRef: string; executionFence: string; idempotencyKey: string; argumentsDigest: string }): Promise<{ status: "succeeded" | "unknown" }>; }
export class ToolExecutionService {
  private readonly executions = new Map<string, { digest: string; state: ToolState }>();
  constructor(private readonly catalog: readonly ToolCatalogEntry[], private readonly broker: CredentialBroker, private readonly sandbox: Sandbox) {}
  async execute(input: { idempotencyKey: string; subjectRef: string; toolName: string; toolVersion: string; argumentsDigest: string; executionFence: string; approvalRef?: string }): Promise<ToolState> {
    const tool = this.catalog.find((entry) => entry.name === input.toolName && entry.version === input.toolVersion);
    if (!tool || tool.externalCapable || !input.executionFence) throw new ToolExecutionError("FORBIDDEN");
    const digest = `${input.subjectRef}:${tool.name}:${tool.version}:${tool.targetRef}:${tool.action}:${input.argumentsDigest}`;
    const existing = this.executions.get(input.idempotencyKey);
    if (existing) { if (existing.digest !== digest) throw new ToolExecutionError("CONFLICT"); return existing.state; }
    if (tool.requiresApproval && !input.approvalRef) { this.executions.set(input.idempotencyKey, { digest, state: "AWAITING_APPROVAL" }); return "AWAITING_APPROVAL"; }
    const credential = await this.broker.issue({ subjectRef: input.subjectRef, targetRef: tool.targetRef, action: tool.action, executionFence: input.executionFence });
    let outcome: { status: "succeeded" | "unknown" };
    try { outcome = await this.sandbox.dispatch({ targetRef: tool.targetRef, action: tool.action, credentialRef: credential.credentialRef, executionFence: input.executionFence, idempotencyKey: input.idempotencyKey, argumentsDigest: input.argumentsDigest }); } catch { throw new ToolExecutionError("DEPENDENCY_UNAVAILABLE"); }
    const state: ToolState = outcome.status === "succeeded" ? "SUCCEEDED" : "OUTCOME_UNKNOWN";
    this.executions.set(input.idempotencyKey, { digest, state }); return state;
  }
}
