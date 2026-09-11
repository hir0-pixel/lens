import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  AgentHarness,
  JsonlSessionRepo,
  NodeExecutionEnv,
  TODO_CONTEXT,
  type HookName,
} from "@earendil-works/pi-agent-core/node";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
  bindLensAgentHooks,
  declineCompaction,
} from "../helpers/lensAgentHarness";

const ROOT = resolve(import.meta.dirname, "../..");
const REQUIRED_HOOKS = [
  "before_tool",
  "after_tool",
  "transform_context",
  "before_request",
  "before_compaction",
] as const satisfies readonly HookName[];

describe("M0 Prime Agent harness", () => {
  it("harness.concurrency.isolation", async () => {
    const instanceCount = 10;
    const suiteRoot = mkdtempSync(join(tmpdir(), "lens-harness-m0-"));
    let activeCalls = 0;
    let maximumConcurrentCalls = 0;

    try {
      const results = await Promise.all(
        Array.from({ length: instanceCount }, async (_, index) => {
          const marker = `M0_MARKER_${String(index).padStart(2, "0")}`;
          const runRoot = join(suiteRoot, `run-${index}`);
          const env = new NodeExecutionEnv({ cwd: runRoot });
          const repo = new JsonlSessionRepo({
            fileSystem: env,
            sessionsRoot: join(runRoot, "sessions"),
          });
          const session = await repo.create(
            { id: `session-${index}`, cwd: runRoot },
            TODO_CONTEXT,
          );
          const faux = fauxProvider({
            provider: `lens-m0-${index}`,
            models: [{ id: `model-${index}` }],
          });
          const models = createModels();
          models.setProvider(faux.provider);
          faux.setResponses([
            async () => {
              activeCalls += 1;
              maximumConcurrentCalls = Math.max(maximumConcurrentCalls, activeCalls);
              await new Promise((done) => setTimeout(done, 25));
              activeCalls -= 1;
              return fauxAssistantMessage(`assistant:${marker}`);
            },
          ]);

          const { harness } = await AgentHarness.create(
            {
              session,
              models,
              model: faux.getModel(),
              tools: [],
              systemPrompt: `identity:${marker}`,
            },
            TODO_CONTEXT,
          );
          const observedContexts: string[] = [];
          harness.hooks.on("transform_context", (event) => {
            observedContexts.push(JSON.stringify(event));
          });
          bindLensAgentHooks(harness);

          try {
            const lane = await harness.lane("main", TODO_CONTEXT);
            await lane.prompt(`context:${marker}`, [], TODO_CONTEXT);
            const entries = await session.findEntries(undefined, TODO_CONTEXT);
            const sessionPath = session.metadata.path;
            return {
              marker,
              sessionPath,
              transcript: JSON.stringify(entries),
              context: observedContexts.join("\n"),
              sessionFile: readFileSync(sessionPath, "utf8"),
            };
          } finally {
            await harness.close(TODO_CONTEXT);
            await repo.close(TODO_CONTEXT);
          }
        }),
      );

      expect(results).toHaveLength(instanceCount);
      expect(maximumConcurrentCalls).toBeGreaterThan(1);
      expect(new Set(results.map(({ sessionPath }) => sessionPath)).size).toBe(instanceCount);

      for (const result of results) {
        expect(existsSync(result.sessionPath)).toBe(true);
        expect(result.transcript).toContain(result.marker);
        expect(result.context).toContain(result.marker);
        expect(result.sessionFile).toContain(result.marker);
        for (const other of results) {
          if (other.marker === result.marker) continue;
          expect(result.transcript).not.toContain(other.marker);
          expect(result.context).not.toContain(other.marker);
          expect(result.sessionFile).not.toContain(other.marker);
        }
      }

      console.info(
        `harness.concurrency.isolation: ${instanceCount} instances, max overlap ${maximumConcurrentCalls}`,
      );
    } finally {
      rmSync(suiteRoot, { recursive: true, force: true });
    }
  });

  it("harness.compaction.declined", () => {
    expect(declineCompaction()).toEqual({ decline: true });
  });

  it("harness.required-hooks", () => {
    const declaration = readFileSync(
      join(ROOT, "vendor/pi-agent-core/dist/harness/agent-harness.d.ts"),
      "utf8",
    );
    for (const hook of REQUIRED_HOOKS) expect(declaration).toContain(`${hook}:`);
  });

  it("harness.no-coding-tools", () => {
    const names = ["Bash", "Write", "Edit", "Read"].map(
      (name) => `create${name}Tool`,
    );
    const callPattern = new RegExp(`\\b(?:${names.join("|")})\\s*\\(`);
    const ignored = new Set([".git", ".cursor", "node_modules", "vendor"]);
    const extensions = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
    const matches: string[] = [];
    const scan = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (ignored.has(entry.name)) continue;
        const path = join(directory, entry.name);
        if (entry.isDirectory()) scan(path);
        else if (extensions.has(entry.name.slice(entry.name.lastIndexOf(".")))) {
          if (callPattern.test(readFileSync(path, "utf8"))) matches.push(path);
        }
      }
    };
    scan(ROOT);
    expect(matches).toEqual([]);
  });

  it("harness.import-opens-no-network-socket", () => {
    const script = `
      import net from "node:net";
      net.Socket.prototype.connect = function () {
        throw new Error("network socket opened during import");
      };
      await import("@earendil-works/pi-agent-core");
    `;
    expect(() =>
      execFileSync(process.execPath, ["--input-type=module", "--eval", script], {
        cwd: ROOT,
        stdio: "pipe",
      }),
    ).not.toThrow();
  });
});
