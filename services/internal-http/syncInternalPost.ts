import { MessageChannel, Worker, receiveMessageOnPort } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const WORKER_PATH = join(dirname(fileURLToPath(import.meta.url)), "syncInternalPostWorker.cjs");

export function syncInternalPost(input: {
  url: string;
  tokenHeader: string;
  token: string;
  path: string;
  body: Record<string, unknown>;
  timeoutMs?: number;
}): { status: number; body: Record<string, unknown> } {
  const timeoutMs = input.timeoutMs ?? 5_000;
  const sab = new SharedArrayBuffer(4);
  const slot = new Int32Array(sab);
  const { port1, port2 } = new MessageChannel();
  const worker = new Worker(WORKER_PATH, {
    workerData: {
      sab,
      port: port2,
      url: input.url,
      path: input.path,
      tokenHeader: input.tokenHeader,
      token: input.token,
      body: input.body,
      timeoutMs,
    },
    transferList: [port2],
  });
  worker.on("error", () => {
    if (Atomics.load(slot, 0) === 0) {
      Atomics.store(slot, 0, 1);
      Atomics.notify(slot, 0, 1);
    }
  });
  Atomics.wait(slot, 0, 0, timeoutMs + 1_000);
  void worker.terminate();
  const received = receiveMessageOnPort(port1);
  if (received && typeof received.message === "object" && received.message !== null) {
    return received.message as { status: number; body: Record<string, unknown> };
  }
  return { status: 0, body: {} };
}
