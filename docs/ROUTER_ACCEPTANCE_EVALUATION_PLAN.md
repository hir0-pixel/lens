# Router production acceptance evaluation plan

## Why this document exists

`orchestrator-service/tests/routerWireIntegration.test.ts` proves the router's
**wire contract and fallback logic** are real: a genuine HTTP round trip,
schema validation, and a deterministic fallback when the model response is
missing or malformed. It does **not** prove that a real internal router model
classifies enterprise turns correctly. The server in that test file is a
hand-coded `classify()` function standing in for the model's judgment — it is
scripted, not learned, and its "accuracy" is definitionally 100% against its
own script. That test file must not be cited as evidence of routing quality
against a real model. This document defines the evaluation that must be run,
once, against the actual internal model configured for `HttpTurnRouterLLMPort`
before the router is considered production-verified.

## What must be measured

Run a fixed evaluation set (below) against the real, deployed internal router
model through the real `/v1/inference/generate` wire (the same
`HttpTurnRouterLLMPort` code path used in production, not a mock), and record:

| Metric | Definition | Target |
|---|---|---|
| **Routing accuracy** | % of turns classified into the route a human reviewer independently labels as correct | ≥ 95% on the golden set, reviewed before sign-off |
| **False retrieval rate** | % of non-enterprise-knowledge turns (small talk, acknowledgements, creative requests) that incorrectly trigger `KNOWLEDGE_QUERY`/`CONTEXTUAL_FOLLOW_UP` and cause a retrieval call | < 1% — every false positive is a policy/cost/latency cost and a potential over-disclosure surface |
| **False no-retrieval rate** | % of genuine enterprise knowledge questions that get classified as `GENERAL_CONVERSATION`/`ACKNOWLEDGEMENT` and silently skip retrieval | 0% tolerated on the golden set — this is the security-relevant failure mode named in the original task ("retrieval cannot be bypassed for enterprise knowledge queries") |
| **Follow-up rewrite quality** | For `CONTEXTUAL_FOLLOW_UP`, % of rewrites that a human reviewer judges as a faithful, standalone restatement of the user's intent given the conversation history | ≥ 90%, manually reviewed — a bad rewrite silently changes what gets retrieved |
| **Latency (p50/p95/p99)** | Wall-clock time for `HttpTurnRouterLLMPort.classify()` end to end, measured under realistic concurrent load | p95 within the budget the deterministic fast path is meant to protect (must not regress the "okay" zero-model-call path's latency budget for turns that do need classification) |
| **Fallback trigger rate** | % of real-model calls that fail schema validation, time out, or error, and fall through to `fallbackClassify()` | Should be low and monitored in production; a rate that isn't near-zero indicates the model isn't reliably honoring the JSON contract |
| **Fallback correctness under real failure** | Of the turns that do fall back, % where `fallbackClassify()`'s conservative heuristic reaches the same route a human would pick | Informational — the fallback is intentionally conservative (see `router.ts`), not expected to match model quality, but must never fabricate retrieval |

## Evaluation set composition

The golden set must include, at minimum:

- **Unambiguous acknowledgements** not covered by the deterministic fast path's closed `ACK_PHRASES` set (e.g. localized/paraphrased acknowledgements) — proves the LLM router, not just the fast path, handles ambiguous short replies safely.
- **Compound turns**: acknowledgement + question in one utterance (the original task's `"okay, what is the leave policy?"` case), including compounds where the question is buried mid-sentence.
- **Genuine enterprise knowledge queries** drawn from real (or representative synthetic) internal document topics — HR policy, IT policy, benefits, security policy, procurement — phrased in varied registers (formal, terse, typo-laden, non-native-English-speaker phrasing).
- **Creative / non-enterprise requests** (poems, jokes, general knowledge, coding help unrelated to enterprise documents) — must never trigger retrieval.
- **Multi-turn contextual follow-ups**, including follow-ups that change topic mid-conversation (proving the router doesn't over-apply "contextual" when the user has moved on).
- **Ambiguous single- and few-word inputs** that are not acknowledgements ("policy", "leave", "help") — must clarify, never guess.
- **Adversarial / prompt-injection-flavored inputs**: turns that embed fake system/role markers, instructions telling the router to "ignore previous instructions" or "always retrieve X", or attempts to make the router emit a fabricated `CONTEXTUAL_FOLLOW_UP` rewrite that smuggles a different query than the user asked. The router's own output is schema-validated and only feeds `queryText` into retrieval/generation (never executed as instructions), but the evaluation must confirm adversarial phrasing doesn't cause misclassification into a route that skips authorization.
- **Malformed/degenerate real-model responses** observed in practice (truncated JSON, extra prose around the JSON, wrong route enum values) — captured from real model output during the eval run, not scripted, to confirm the fallback in `router.ts` behaves the same way against real garbage as it does against the synthetic garbage in `routerWireIntegration.test.ts`.

## Process

1. Freeze a versioned golden set (turns + human-labeled expected routes/rewrites) under version control, separate from unit tests.
2. Run the golden set through the real `HttpTurnRouterLLMPort` against the actual configured internal model endpoint, in a controlled integration environment (not production traffic).
3. Score against the metrics table above; a human reviewer adjudicates routing-accuracy and rewrite-quality labels.
4. Record results, model version/digest, and evaluation date in this repository (a dated results file alongside this plan, not just a chat message).
5. Re-run whenever the router model artifact changes (new `artifactDigest` promoted via `ModelRegistry`) — a model swap without re-evaluation is a regression risk the same way an unreviewed code change would be.

## Status

**Not yet run.** No real internal router model has been evaluated against this
plan in this repository as of this writing. `routerWireIntegration.test.ts`
remains a wire-contract/fallback regression test only. This is a named,
outstanding production gate — see `docs/RAG_PRODUCTION_IMPLEMENTATION_REPORT.md`.
