# M0 — Vendor the Harness, and Prove It Is Safe to Build On

**Wave 1. Nothing else starts until this is signed off.**

> **Revision 3 — 2026-09-10.** Adds the `--prefer-online` requirement and an
> install-scripts note to §1. If you hit `ETARGET` on
> `@smithy/node-http-handler`, read the callout there — it is a cache artifact,
> and the fix is not a dependency override.
>
> **Revision 2 — 2026-09-10. This module changed substantially.** The vendoring
> source is now npm `@earendil-works/pi-agent-core@0.85.1`, not the Prime
> Intellect repository. The `piConfig` rebrand step has been removed. A
> baseline-repair step has been added as §0. If you started against revision 1,
> discard that work and begin again here.

Prerequisite: read `00-START-HERE.md` completely.

---

## Goal

Get the Prime Agent harness into the repository, pinned and building, with the
existing test suite still green — and then answer one question that can
invalidate the entire project:

> **Does the harness keep any state that is shared between concurrent runs?**

## Why this is first

Prime Agent was built for a coding agent: one developer, one machine, one
session at a time. Lens is multi-tenant — dozens of employees running agents
against the same server simultaneously.

If the harness holds any state at module scope (a session registry, a config
singleton, a cached context object), two concurrent runs can collide. In Lens
that collision means **one employee seeing another employee's documents.**

That failure would never appear in single-user testing. It is also the kind of
problem that, if real, changes the architecture — so it must be found now,
before five other modules are built on top of the assumption that it is fine.

This is a half-day test. Do it on day one.

---

## What to do

### 0. Fix the baseline first

`npm run typecheck` currently fails on `main` — `@tabler/icons-react` is
declared in `package.json` but not installed. Run `npm install`, then confirm:

```bash
npm run typecheck; echo "exit: $?"
```

Do not pipe that into `tail` or `head` — you will read the pager's exit code
instead of the compiler's and get a false green. That mistake is what produced
the incorrect "baseline verified" claim in an earlier draft of these documents.

Do not begin vendoring until the baseline is genuinely green.

### 1. Vendor the harness — from npm, not the repo

```bash
npm pack @earendil-works/pi-agent-core@0.85.1 --prefer-online
```

> **`--prefer-online` is required, not optional.** This repo's `.npmrc` sets
> `prefer-offline=true`, which makes npm resolve against its local cache and
> only reach the network on a miss. With a stale cached packument you will get
> an `ETARGET` failure for a version that genuinely exists — most likely on
> `@smithy/node-http-handler@4.7.3`, pinned by `pi-ai`.
>
> That error is a cache artifact, not a broken package. Verified 2026-09-10:
> `@smithy/node-http-handler@4.7.3` is published, and the full
> `pi-agent-core@0.85.1` tree resolves cleanly — 99 packages, exit 0.
>
> If you hit it: `npm cache clean --force`, or add `--prefer-online`. **Do not
> add a dependency override.** Pinning smithy back to 4.0.2 puts you twelve
> minor releases behind what the AWS Bedrock transport expects, in order to work
> around a stale cache.
>
> Leave `prefer-offline=true` in `.npmrc` alone — it is deliberate for
> air-gapped builds.

**Heads-up on install scripts.** Three transitive packages carry install
scripts not covered by `allowScripts`: `esbuild`, `@google/genai`, and
`protobufjs`. Review them against your supply-chain policy before approving —
for a sovereign product this is a real decision, not a formality. Record what
you approved and why in the review packet.

Vendor the contents into the Lens repo under `vendor/`. Vendor rather than
depend on the registry at build time: this is a sovereign product that must
build air-gapped.

**Take version 0.85.1 from npm.** Do *not* take `packages/agent` from
`PrimeIntellect-ai/prime-agent`. Despite the higher-looking `0.9.4`, that is an
older fork whose entire source is five files — `agent-loop.ts`, `agent.ts`,
`index.ts`, `proxy.ts`, `types.ts` — with no `harness/` directory. None of the
hooks, sessions or compaction this plan depends on exist there. See
`00-START-HERE.md` §3.

- Pin the exact version. No semver ranges.
- `pi-agent-core` declares `@earendil-works/pi-ai` as a runtime dependency.
  It comes along; that is expected. M2 covers how we stop it reaching the
  network.
- Record the exact version and integrity hash alongside the vendored code so an
  auditor can verify what was taken.
- Preserve the MIT licence text and attribution.

Do **not** vendor `pi-coding-agent` or `pi-tui`.

### 2. No rebrand step

An earlier draft told you to add a `piConfig` block. **Ignore that.** `piConfig`
is consumed by `pi-coding-agent`, which we do not use; `pi-agent-core` does not
read it. There is nothing to rebrand.

### 3. Confirm the coding tools are absent

The harness ships `createBashTool`, `createReadTool`, `createWriteTool`,
`createEditTool`. These are factories — they do nothing unless called.

Verify that nothing in the Lens codebase calls them, and add a check that keeps
it that way (see automated DoD below).

### 4. Decline compaction

Compaction is how the harness handles a conversation outgrowing the context
window: it summarises older messages and drops the originals.

That is a problem for Lens, because the original transcript is what an audit
needs. A compacted run replaces the record of what happened with a summary the
model wrote about itself.

We are not building the audit-archiving path yet — Phase 1 tasks are short and
will not trigger compaction. But we must not allow it to happen silently in the
meantime. Bind the hook to decline:

```ts
before_compaction: () => ({ decline: true })
```

If a task ever does grow long enough to trigger compaction, it fails loudly
instead of quietly destroying lineage. The real archive path is a later module.

### 5. Run the concurrency proof

Write a test that runs **two harness instances concurrently**, each with a
distinct identity and distinct data, and asserts they cannot observe each
other.

Minimum shape:

- Two runs started in parallel, not sequentially.
- Each run is given a different marker value in its context.
- Assert: neither run's transcript, context, or session state contains the
  other's marker.
- Assert: each run's session files are written to distinct locations.
- Run it with more than two concurrent instances as well — at least ten — since
  some race conditions only appear under pressure.

**If this test cannot be made to pass, stop and report immediately.** Do not
work around it. Do not add a mutex and continue. This result determines whether
the rest of the plan is viable, and the answer is more valuable than a fix.

---

## Definition of Done — Automated

Every item must be green.

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm test` exits 0
- [ ] `npm run validate` exits 0
- [ ] A test named `harness.concurrency.isolation` exists, runs at least 10
      concurrent harness instances, and asserts no cross-run state visibility
- [ ] A test named `harness.no-coding-tools` asserts that
      `createBashTool`, `createWriteTool`, `createEditTool` and `createReadTool`
      are never called anywhere in the codebase (a source scan is acceptable)
- [ ] A test named `harness.compaction.declined` asserts the
      `before_compaction` hook returns `{ decline: true }`
- [ ] A test asserting the vendored package opens no network socket at import
      time
- [ ] The exact vendored version (`0.85.1`) and its integrity hash are recorded
      in a file under `vendor/`
- [ ] A test asserting the vendored `pi-agent-core` exposes the hooks this plan
      depends on — at minimum `before_tool`, `after_tool`, `transform_context`,
      `before_request`, `before_compaction`. If any is missing, the wrong
      artifact was vendored; stop and report

## Definition of Done — Manual

Verified by hand by the requester.

- [x] The vendored directory contains `pi-agent-core` (plus its runtime
      dependency `pi-ai`, which is expected) — and no `pi-coding-agent`, no
      `pi-tui`
- [x] The vendored `pi-agent-core` has a `harness/` directory (published by
      npm at `dist/harness/`). If it does not, the wrong artifact was taken —
      see `00-START-HERE.md` §3
- [x] The MIT licence file is present and attribution is intact
- [x] The vendored artifact is pinned to exactly `0.85.1`, not a range — Lens
      references the versioned local tarballs directly. The `^0.85.1` entries
      inside the preserved upstream package manifest are its published
      transitive dependency constraints; `package-lock.json` resolves each of
      them to exactly `0.85.1`
- [x] Searching the codebase for `createBashTool` returns only the vendored
      definition, never a call site
- [x] The build produces the same artifacts as before this change for every
      pre-existing entrypoint
- [x] Application starts and the existing chat feature works exactly as it did
      before — ask it a question, get an answer with citations
- [x] The concurrency test result is reported explicitly in the review packet,
      whether it passed or failed

---

## Must NOT change

A diff touching any of these fails review regardless of test results.

```
services/**
server/**
src/**
contracts/**
```

This module adds vendored code and tests. It changes no Lens service, no route,
and no contract. If you believe it must, stop and ask.

---

## Review packet

Provide:

1. `git diff --stat` for the whole change
2. `git diff --stat -- services server src contracts` — must be empty
3. Full output of `npm run validate`, and of `npm run typecheck; echo "exit: $?"`
   showing the true exit code (not piped into a pager)
4. Full output of the concurrency test, including the concurrent instance count
5. The recorded vendored version (`0.85.1`) and its integrity hash, plus a
   directory listing of the vendored package showing `harness/` is present
6. A one-paragraph statement of what the concurrency test actually proved —
   specifically, whether any shared module-level state was found

Item 6 is the one that matters most. Write it in plain language.
