# START HERE — Lens Agent Integration

> **Revision 3 — 2026-09-10.** §7 now covers the `ETARGET` failure on
> `@smithy/node-http-handler` that a plain `npm install` produces in this repo.
> It is a stale-cache artifact; use `--prefer-online`. Do **not** add a
> dependency override.
>
> **Revision 2 — 2026-09-10.** If you read revision 1, four things changed and
> all four were errors in the original:
>
> 1. **Vendor `@earendil-works/pi-agent-core@0.85.1` from npm**, not
>    `packages/agent` from the Prime Intellect repo. Rev 1 documented the npm
>    package's API while pointing at the repo, whose 0.9.4 is an older fork with
>    five source files and no hooks. §3.
> 2. **`pi-ai` is a runtime dependency**, not a type-only one as rev 1 claimed.
> 3. **There is no `piConfig` rebrand step.** That block belongs to
>    `pi-coding-agent`, which we do not use.
> 4. **The baseline is currently red**, not green as rev 1 stated. `npm install`
>    fixes it. §7.
>
> Thanks to whoever caught these — the report was correct on every point.

Read this file completely before opening any module file. It contains context
that every module assumes you already have.

If you are an AI coding agent: this file defines constraints that override
your default judgement. Do not skip it, and do not begin implementation until
you have read the module file you have been assigned in full.

---

## 1. What Lens is

Lens is a **sovereign AI platform** for enterprises. The essential facts:

- A company hosts (or controls) one AI model. The company owns the API key.
- The key lives **server-side only**. Employees never see it, ever.
- Employees worldwide use the model through Lens.
- Lens has a RAG system over company documents (policies, contracts, manuals).
- **Different employees are entitled to different documents.** Scoping is
  enforced server-side by identity, never by asking the model nicely.

Lens's value is that all of the above stays true under load, under attack, and
under audit. Any change that makes the product "work better" while weakening
one of those properties is a regression, not a feature.

## 2. What we are adding, and why

Today Lens answers questions. One retrieval, one answer.

> "What is our refund policy?" — works fine.

Today Lens **cannot be given a task**.

> "Check every Q3 contract against the new refund policy and list the
> conflicts." — fails.

That request needs many steps with intermediate results: find the contracts,
open each one, compare against the policy, collect the conflicts, write it up.
One-shot retrieval cannot do it. It returns a plausible paragraph that looks
correct and is not — which is worse than failing.

We are adding a **multi-step agent loop** so Lens can be assigned tasks.

## 3. What Prime Agent is

You are not building the agent loop. You are integrating an existing one.

**Prime Agent** is an open-source agentic harness released by Prime Intellect
in August 2026 under the MIT licence.

- Prime Intellect repository: `https://github.com/PrimeIntellect-ai/prime-agent`
- Language: TypeScript
- Licence: MIT

**Prime Agent is a rebrand of a harness called `pi`.** Inside the Prime
Intellect repository the packages are named `@earendil-works/pi-*` and the
binary is called `pi`. That is expected, not a mistake.

### Which artifact to take — read this carefully

There are **two release lines of the same packages**, and they are far apart:

| Source | `pi-agent-core` version | What's in it |
|---|---|---|
| **npm** (`@earendil-works/pi-agent-core`) | **0.85.1** | The full harness — hooks, sessions, compaction, skills, retry/recovery. ~90 modules |
| PrimeIntellect-ai/prime-agent repo | 0.9.4 | An early fork. `packages/agent/src` contains **five files** and no `harness/` directory at all |

The version numbers mislead: semver compares the minor as **85 vs 9**, so
`0.85.1` is far *newer* than `0.9.4`. The Prime Intellect repository carries an
older snapshot of the harness plus their own coding-agent layer on top.

> **Vendor from npm: `@earendil-works/pi-agent-core@0.85.1`.**
>
> Do **not** vendor `packages/agent` from the Prime Intellect repository. At
> commit `f771dfce` it has no hooks, no session persistence and no compaction —
> none of the API this plan depends on exists there.

Relevant packages:

| Package | What it is | Do we use it? |
|---|---|---|
| `@earendil-works/pi-agent-core` | The harness — agent loop, hooks, sessions, retry, recovery | **Yes — 0.85.1 from npm** |
| `@earendil-works/pi-ai` | Unified LLM API | **Yes, as a runtime dependency** of the harness. We do not let it reach the network — see M2 |
| `@earendil-works/pi-coding-agent` | A coding-agent CLI | **No** |
| `@earendil-works/pi-tui` | Terminal UI | **No** |

`pi-ai` is a genuine runtime dependency declared by `pi-agent-core`, not a
type-only one. You cannot omit it. M2 covers how we prevent it from making
network calls of its own.

**On `piConfig`:** the Prime Intellect repo rebrands via a `piConfig` block, but
that block lives in `pi-coding-agent` — the package we do not use.
`pi-agent-core` does not consume it. There is no rebrand step for us. Ignore
any instruction to add one.

Pin the exact version. Never a range.

## 4. What we take from Prime Agent — and what we do not

**We take, unmodified:**

- the agent loop
- retry, crash recovery, checkpointing, reconciliation
- session transcripts and forking
- context compaction machinery
- the hook system
- skills infrastructure

**We do not take:**

- its built-in coding tools — `bash`, `write`, `edit`, `read`. These exist as
  opt-in factories (`createBashTool` and friends). We simply never call those
  factories. **Do not construct them. Do not "just enable read for now."**
- the CLI and terminal UI (separate packages — do not install them)
- its direct provider calls (see M2)

**We write ourselves:**

- Lens's own tools, which operate on the document corpus rather than a filesystem
- the bindings between the harness's hooks and Lens's existing security services

## 5. How the harness lets us control it

The harness exposes **hooks**. A hook is a callback that fires at a specific
point in the loop, and several of them can alter or veto what happens next.

The ones this project uses:

| Hook | Fires | Can do |
|---|---|---|
| `before_tool` | before a tool executes | rewrite arguments, or **block** the call |
| `after_tool` | after a tool returns | rewrite the result, force an error |
| `transform_context` | before the model is called | rewrite messages and system prompt |
| `before_request` | before each model request | patch request options |
| `before_compaction` | before context compaction | **decline** compaction |

`before_tool` returning a `block` is the mechanism that lets Lens's policy
engine veto anything the model tries to do. This is the centre of the whole
integration.

The model call itself is also injectable — `agentLoop` takes a `streamFn`
parameter, so the harness never has to talk to a provider directly. M2 covers
this.

## 6. The Lens services you will interact with

You do not need to understand all of Lens. You need these:

| Path | What it does |
|---|---|
| `services/pdp/PolicyDecisionPoint.ts` | **Policy Decision Point.** Decides what a given employee may access. |
| `services/retrieval/` | Retrieval over the document corpus |
| `services/model-gateway/`, `services/model-provider/` | Calls the company's model |
| `services/orchestrator/` | Composes retrieval and generation |
| `services/agent-runtime/AgentRuntime.ts` | Existing run/step envelope machinery |
| `server/src/routes/api.ts` | The BFF — the only thing the browser talks to |

The PDP is the important one. Its shape:

```ts
decideBatch(input: {
  requestId: string;
  callerWorkloadRef: string;
  subjectRef: string;          // the employee
  deviceRef: string;
  action: string;
  resourceRefs: readonly string[];
  normalizedContextDigest: string;
  useBoundary?: "operation" | "generation_start" | "tool_boundary";
  deadlineAt: number;
}): { allowed: readonly string[]; fence?: DecisionFence }

consumeFence(fence: DecisionFence, input: {...}): void   // throws on replay
```

Two things worth noticing:

1. `useBoundary` already includes `"tool_boundary"`. The PDP was designed
   anticipating tool-call gating. You are not inventing this.
2. `decideBatch` returns an **allowlist** of resource refs plus a signed,
   single-use `DecisionFence`. `consumeFence` throws `FENCE_INVALID` if a fence
   is replayed.

It takes its facts through an injected `FactReaders` interface, which means
**every PDP behaviour in this project is unit-testable without a network.**
There is no excuse for an untested policy path.

## 7. Global invariants

These must hold after **every** module, not just at the end. Every module's
checklist re-verifies them.

| ID | Invariant |
|---|---|
| **G1** | The provider key never reaches the browser, and never enters the agent process environment |
| **G2** | Retrieval is always scoped to the requesting employee — never a service-privileged token |
| **G3** | The sovereign profile still refuses non-`openai-compatible` adapters (`services/model-provider/createModelProviderAdapter.ts`) |
| **G4** | The existing one-shot RAG path behaves exactly as before |
| **G5** | `npm run validate`, `npm run typecheck`, `npm run lint`, `npm test` all pass |
| **G6** | `contracts/` registry and `contracts/compatibility/v1.json` remain unbroken |
| **G7** | No new outbound network egress from any service |
| **G8** | `ADMIN_SUBJECTS` / `requireAdmin` still gates admin routes |

### Baseline is currently RED — fix before starting

`npm run typecheck` fails on `main` as of 2026-09-10 with two errors:

```
src/components/icons/tabler.tsx(171,8): error TS2307:
  Cannot find module '@tabler/icons-react' or its corresponding type declarations.
src/components/icons/tabler.tsx(172,33): error TS2307: ...
```

This is **not a code defect**. `@tabler/icons-react` is declared in
`package.json` at `^3.46.0`, that version exists and resolves on npm — it is
simply not installed locally. Install it:

```bash
npm install --prefer-online
```

> **Use `--prefer-online`.** This repo's `.npmrc` sets `prefer-offline=true`, so
> npm resolves against its local cache and only reaches the network on a miss.
> With a stale cached packument, a plain `npm install` fails with `ETARGET` for
> a version that genuinely exists — most likely
> `@smithy/node-http-handler@4.7.3`, pinned transitively by `pi-ai`.
>
> That is a cache artifact, not a broken package. Verified 2026-09-10: that
> version is published, and the full `pi-agent-core@0.85.1` tree resolves
> cleanly — 99 packages, exit 0.
>
> If it persists, `npm cache clean --force` and retry. **Do not add a
> dependency override**, and do not remove `prefer-offline=true` from `.npmrc` —
> it is deliberate for air-gapped builds.

Confirm the baseline is green *before* you begin any module, and beware of a
trap that produced a false green earlier in this project:

```bash
# WRONG — reports tail's exit code, not tsc's. Always looks like success.
npm run typecheck | tail -20

# RIGHT
npm run typecheck; echo "exit: $?"
```

If typecheck still fails after `npm install`, stop and report it rather than
building on a red baseline.

## 8. Module sequence

Modules are ordered by risk, not by dependency convenience. The riskiest
assumption is tested first, on throwaway code, before anything is built on it.

```
Wave 1     M0  Vendor + concurrency proof
              |
Wave 2     M1  Governance binding    ||   M2  Model transport      (parallel)
              |
Wave 3     M3  First corpus tool     ||   M4  Context binding      (parallel)
              |
Wave 4     M5  Routing seam
```

Modules in the same wave touch different files and can be worked by different
people simultaneously.

| Module | File |
|---|---|
| M0 | `01-M0-vendor.md` |
| M1 | `02-M1-governance-binding.md` |
| M2 | `03-M2-model-transport.md` |
| M3 | `04-M3-corpus-tool.md` |
| M4 | `05-M4-context-binding.md` |
| M5 | `06-M5-routing-seam.md` |

**Do not start a module until every module in the previous wave is complete
and signed off.** M0 in particular can invalidate the entire plan — see its
concurrency section.

## 9. How each module defines "done"

Every module file has **two** definitions of done. Both must pass.

### Definition of Done — Automated

Machine-checkable. Named tests that must exist and pass, plus commands that
must exit zero. If you are an AI coding agent, this is your acceptance
criteria — do not report a module complete until every item here is green.

Writing a test that passes by weakening the assertion is a failure, not a
completion. If a test cannot pass, stop and report why.

### Definition of Done — Manual

Things a human verifies by hand, because they cannot be meaningfully automated
or because a human should look with their own eyes before it ships. The person
who requested this work will run these.

### Must NOT change

Each module lists paths it may not modify. **A diff touching a listed path
fails review regardless of whether the tests pass.**

This is deliberate. Most of these modules bind *to* an existing security
service. If a test fails, the correct response is to fix the binding — not to
adjust the security service until the test goes green. If you genuinely believe
a listed file must change, stop and raise it as a question. That is a
conversation, not a commit.

## 10. Ground rules

1. **Do not modify the PDP, RetrievalService, or the provider adapters.**
   Every module binds to them. None of them changes.
2. **Fail closed, always.** If a policy check cannot be completed — service
   unreachable, timeout, exception — the answer is *deny*. Never proceed on the
   assumption that a failed check would have passed.
3. **Never construct the harness's built-in coding tools.**
4. **No new outbound network calls.** Anything that talks to the outside world
   goes through the existing gateway.
5. **The model is not a security boundary.** Never enforce entitlements by
   telling the model what it may access. Enforce them in code, server-side,
   before the model sees anything.
6. **Test before moving on.** A module is not done when the code works. It is
   done when the invariants are proven to still hold.

## 11. Handing work back for review

Each module file ends with a **Review packet** section listing what to produce
when the module is complete. Include all of it. Reviews without evidence get
sent back.

Generally: the diff, test output, the commands you ran, and explicit
confirmation that the "Must NOT change" paths are untouched
(`git diff --stat` against those paths showing no entries).
