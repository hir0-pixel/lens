# M1 — Governance Binding

**Wave 2, lane A. Runs in parallel with M2. Requires M0 signed off.**

> **Revision 2 — 2026-09-10.** This module is unchanged in substance. It now
> assumes the harness vendored in M0 is npm `pi-agent-core@0.85.1`, which is
> where the `before_tool` hook described below actually exists.

Prerequisite: read `00-START-HERE.md` completely.

---

## Goal

Make it impossible for the agent to execute a tool without a policy decision.

Bind the harness's `before_tool` hook to Lens's Policy Decision Point, so that
every action the model proposes is authorised before it happens — and blocked
if it is not.

## Why this uses a throwaway tool

You will prove this binding using a **deliberately trivial tool** — an `echo`
tool that does nothing but return its input.

That is intentional. This module exists to prove the security mechanism works
before any real capability is built on top of it. If the binding turns out not
to compose with the PDP, we need to know that on a worthless tool, not after
the corpus tools are written.

The `echo` tool is scaffolding. A later module may delete it.

---

## What to use from Prime Agent

The harness fires `before_tool` before any tool executes. Its handler receives
the tool name and arguments, and may return a `block`:

```ts
before_tool: {
  event: {
    toolCallId: string;
    toolName: string;
    args: Record<string, JsonValue>;
  };
  result: {
    args?: Record<string, JsonValue>;      // rewrite arguments
    block?: { reason: string; terminate?: boolean };   // veto the call
  } | undefined;
}
```

Returning `block` prevents the tool from running. `reason` is surfaced to the
model so it can adapt. `terminate: true` ends the whole run.

There is a matching `after_tool` hook that fires once a tool returns, and can
rewrite the result.

Hook events also carry `runId` and `lane`, which are useful correlation ids.

The hook runner is already fail-closed by design — but you must not rely on
that alone. Make your own handler fail closed explicitly, and test it.

---

## What to use from Lens

`services/pdp/PolicyDecisionPoint.ts`:

```ts
decideBatch(input: {
  requestId: string;
  callerWorkloadRef: string;
  subjectRef: string;
  deviceRef: string;
  action: string;
  resourceRefs: readonly string[];
  normalizedContextDigest: string;
  useBoundary?: "operation" | "generation_start" | "tool_boundary";
  deadlineAt: number;
}): { allowed: readonly string[]; fence?: DecisionFence }

consumeFence(fence: DecisionFence, input: {...}): void
```

Use `useBoundary: "tool_boundary"` — it exists for exactly this purpose.

---

## What to do

1. Implement a `before_tool` handler that calls `decideBatch` with
   `useBoundary: "tool_boundary"`.

2. Derive `normalizedContextDigest` deterministically from the tool name and
   its arguments. The same call must always produce the same digest; different
   calls must not collide. This digest is what binds the returned fence to this
   specific intent.

3. If the decision does not authorise the call — no fence returned, or an empty
   allowlist — return `block` with a reason that does not leak information the
   employee is not entitled to. "Not permitted" is fine. Naming a document they
   cannot see is not.

4. If the decision does authorise the call, consume the fence via
   `consumeFence` before allowing execution to proceed. A fence is single-use;
   consuming it is what prevents replay.

5. Bind `after_tool` to record the outcome.

6. Register the throwaway `echo` tool so there is something to gate.

### Fail-closed is the point

If `decideBatch` throws, times out, or the PDP is unreachable, the handler must
**block**. Not proceed. Not retry-then-proceed. Not log-and-continue.

This is the single most important behaviour in the entire integration. The
natural implementation bug — "the policy check failed, so carry on" — is a
silent security breach that every functional test in the suite would pass.

It is also trivially testable: `PolicyDecisionPoint` takes its facts through an
injected `FactReaders` interface, so a test can inject a reader that throws and
assert the tool was blocked. No network required.

---

## Definition of Done — Automated

- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run validate` all exit 0
- [ ] Test `pdp.tool.denied-blocks` — a PDP denial results in the tool not
      executing, and `block` returned with a reason
- [ ] Test `pdp.tool.allowed-proceeds` — an authorised call executes and its
      fence is consumed
- [ ] **Test `pdp.tool.fail-closed`** — inject a `FactReaders` implementation
      that throws; assert the tool is **blocked**, not admitted. Assert this for
      a thrown exception, and separately for a decision that exceeds
      `deadlineAt`
- [ ] Test `pdp.tool.fence-replay-rejected` — reusing a consumed fence throws
      `FENCE_INVALID` and the call is blocked
- [ ] Test `pdp.tool.every-call-decided` — over a multi-step run, assert the
      number of tool executions equals the number of consumed fences. No tool
      may execute without one
- [ ] Test `pdp.tool.digest-stable` — the same tool call produces the same
      `normalizedContextDigest`; different calls produce different digests
- [ ] Test asserting a block `reason` never contains a resource identifier the
      subject is not entitled to

## Definition of Done — Manual

- [ ] Start the app, trigger an agent run that attempts a tool call, and
      confirm in logs that a PDP decision was made before execution
- [ ] Stop the PDP (or force it to fail) and confirm the agent **refuses to
      act** rather than continuing. This is the behaviour to see with your own
      eyes — do not accept it on the strength of a passing test alone
- [ ] Confirm the block message shown to a user reveals nothing about documents
      or resources they cannot access
- [ ] Confirm the existing chat feature still works unchanged

---

## Must NOT change

```
services/pdp/**
services/retrieval/**
services/model-provider/**
contracts/**
```

This module binds **to** the PDP. It does not modify the PDP.

If a test fails, fix the binding. Do not adjust the policy engine until the
test goes green — that is how security properties get quietly deleted. If you
believe the PDP interface is genuinely wrong for this use, stop and raise it as
a question before writing any code.

---

## Review packet

1. `git diff --stat`
2. `git diff --stat -- services/pdp services/retrieval services/model-provider contracts` — must be empty
3. Full output of `npm run validate`
4. Full output of every test named above, individually
5. A short description of how `normalizedContextDigest` is derived
6. A screen recording or log excerpt of the manual PDP-failure test, showing
   the agent refusing to act

Item 6 is required. A passing unit test and an observed refusal are different
kinds of evidence, and this behaviour warrants both.
