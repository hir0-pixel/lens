import { describe, expect, it } from "vitest";
import { RagComposition, RagError, type RetrievalRequest, type RetrievedContext } from "../../services/orchestrator";

const digest = (letter: string) => `sha256:${letter.repeat(64)}` as const;
const request = (overrides: Partial<RetrievalRequest> = {}): RetrievalRequest => ({
  requestId: "request-1", subjectRef: "subject-1", purposeRef: "assistant", queryDigest: digest("a"), deadlineAt: 2_000, requireGroundedContext: true, ...overrides,
});
const source: RetrievedContext = {
  documentVersionRef: "document-version-1", chunkRef: "chunk-1", contentDigest: digest("b"), citationAnchor: "page:1", classificationRef: "internal", text: "governed source text",
};

function harness(options: { result?: "context" | "no_context" | "denied_policy" | "failed_downstream"; refreshed?: RetrievedContext | undefined } = {}) {
  const calls: string[] = [];
  const composition = new RagComposition(
    {
      retrieve: async () => {
        calls.push("retrieve");
        if ((options.result ?? "context") !== "context") return { status: options.result ?? "no_context" } as const;
        return { status: "context" as const, manifest: { digest: digest("c"), retrievedAt: 1_000, sourceRevisionDigest: digest("d"), sources: [{ ...source, text: undefined }] }, sources: [source] };
      },
      refreshCitation: async () => { calls.push("refresh"); return options.refreshed ?? source; },
    },
    { authorizeContextUse: async ({ useBoundary }) => { calls.push(`authorize:${useBoundary}`); return { fence: `${useBoundary}-fence` }; } },
    { now: () => 1_000 },
  );
  return { composition, calls };
}

describe("M06 Orchestrator RAG composition", () => {
  it("composes immutable authorized context and revalidates it immediately before generation", async () => {
    const { composition, calls } = harness();
    const context = await composition.compose(request());
    expect(context).toMatchObject({ noContext: false, manifest: { sources: [expect.objectContaining({ chunkRef: "chunk-1" })] } });
    await expect(composition.authorizeGeneration(request(), context)).resolves.toBe("generation-fence");
    expect(calls).toEqual(["retrieve", "authorize:generation"]);
  });

  it("collapses no-match and all-denied candidate results to the same no-context outcome", async () => {
    const noMatch = harness({ result: "no_context" });
    const deniedCandidates = harness({ result: "no_context" });
    await expect(noMatch.composition.compose(request())).resolves.toEqual({ noContext: true });
    await expect(deniedCandidates.composition.compose(request())).resolves.toEqual({ noContext: true });
  });

  it("fails closed for operation denial, dependency loss, cancellation, and malformed source manifests", async () => {
    await expect(harness({ result: "denied_policy" }).composition.compose(request())).rejects.toMatchObject<Partial<RagError>>({ code: "FORBIDDEN" });
    await expect(harness({ result: "failed_downstream" }).composition.compose(request())).rejects.toMatchObject<Partial<RagError>>({ code: "DEPENDENCY_UNAVAILABLE" });
    const controller = new AbortController(); controller.abort();
    await expect(harness().composition.compose(request(), controller.signal)).rejects.toMatchObject<Partial<RagError>>({ code: "CANCELLED" });

    const invalid = new RagComposition({ retrieve: async () => ({ status: "context", manifest: { digest: digest("c"), retrievedAt: 1_000, sourceRevisionDigest: digest("d"), sources: [] }, sources: [source] }), refreshCitation: async () => source }, { authorizeContextUse: async () => ({ fence: "fence" }) }, { now: () => 1_000 });
    await expect(invalid.compose(request())).rejects.toMatchObject<Partial<RagError>>({ code: "INVALID_ARGUMENT" });
  });

  it("re-discloses citations only after a fresh citation fence and rejects changed immutable identities", async () => {
    const { composition, calls } = harness();
    const context = await composition.compose(request());
    if (context.noContext) throw new Error("expected context");
    await expect(composition.resolveCitation(request(), context, source)).resolves.toEqual(source);
    expect(calls).toEqual(["retrieve", "authorize:citation", "refresh"]);

    const changed = harness({ refreshed: { ...source, contentDigest: digest("e") } });
    const changedContext = await changed.composition.compose(request());
    await expect(changed.composition.resolveCitation(request(), changedContext, source)).rejects.toMatchObject<Partial<RagError>>({ code: "STALE_AUTHORITY" });
  });
});
