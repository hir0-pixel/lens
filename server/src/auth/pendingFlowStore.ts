import { getConfig } from "../config";
import { timingSafeCompare } from "../utils/crypto";
import { randomBase64Url } from "../utils/crypto";

export interface PendingFlowRecord {
  verifier: string;
  nonce: string;
  state: string;
  expiresAt: number;
}

export interface PendingFlowStore {
  put: (flow: PendingFlowRecord) => void;
  take: (state: string | undefined) => PendingFlowRecord | undefined;
  cleanup: () => void;
}

export function createPendingFlowStore(options?: {
  random?: (size?: number) => string;
  now?: () => number;
}): PendingFlowStore {
  const cfg = getConfig();
  const pending = new Map<string, PendingFlowRecord>();
  const now = options?.now ?? (() => Date.now());
  const random = options?.random ?? randomBase64Url;

  function cleanup() {
    const current = now();
    for (const [state, flow] of pending) {
      if (flow.expiresAt <= current) pending.delete(state);
    }
  }

  return {
    put(flow) {
      pending.set(flow.state, flow);
    },
    take(state) {
      cleanup();
      if (typeof state !== "string" || state.length === 0 || state.length > 512) {
        return undefined;
      }
      const flow = pending.get(state);
      if (!flow) return undefined;
      pending.delete(state);
      if (flow.expiresAt <= now()) return undefined;
      if (!timingSafeCompare(state, flow.state)) return undefined;
      return flow;
    },
    cleanup,
  };
}
