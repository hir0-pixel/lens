# M7 — Dev-Mode Agent Policy Facts

**Implementation module. Small, sharply scoped, security-sensitive.** Requires
M6b merged. Your branch will be audited against this document by someone who
did not write the code.

Prerequisite: read `lens-agent-integration/00-START-HERE.md` completely — the
invariants G1–G8 and ground rules override your default judgement.

---

## Token discipline

1. Load the `ponytail` skill first. Shortest working diff, reuse over reinvention.
2. Query the codebase graph before reading files:
   ```bash
   ~/.local/bin/codebase-memory-mcp cli search_graph --project=<project-id> --query="<symbol>"
   ```
   If not installed: `curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash`, then `codebase-memory-mcp cli index_repository --repo_path=<repo>`. Read whole files only when editing them.

## The problem

`orchestrator-service/src/service.ts:875` — an `agentMode` request throws
`FORBIDDEN "Agent policy is unavailable."` unless `agentPolicyReplica` was
injected, and only tests inject it. On a real dev stack nobody can run the
agent path. The Prime Agent and MCP integrations are complete but cannot be
manually exercised, so the integration test guide (`08-INTEGRATION-TEST-GUIDE.md`)
is blocked on this module.

## The precedent — mirror it exactly

`authority-service/src/main.ts` lines ~26–60 and `authority-service/src/pdpAdapter.ts`:
`LENS_AUTHORITY_ALLOW_DEV_FACTS=true` wires a real `PolicyDecisionPoint`
against auto-registering subject/device readers and a resource reader that
publishes any ref, with an HMAC signer keyed by
`LENS_AUTHORITY_DEV_PDP_SIGNING_KEY`. **Read the comment block at line ~30 in
full** — it states the contract: dev/test only, must never be set in a real
deployment, service fails closed without it. Your comment says the same,
adapted.

Also read, read-only: `orchestrator-service/src/agentPdpReplica.ts` for the
`agentPolicy` input shape `createAgentPolicyReplica` expects — `factReaders`,
`policyBundle`, `signer`. You supply that shape. You do not modify that file.

## What to build

- New env on `OrchestratorServiceEnv` in `orchestrator-service/src/main.ts`:
  `LENS_ORCHESTRATOR_ALLOW_DEV_AGENT_FACTS` (`"true"` enables) and
  `LENS_ORCHESTRATOR_DEV_AGENT_SIGNING_KEY` (required when enabled). Follow the
  existing naming and comment style in that file.
- New file `orchestrator-service/src/agentDevFacts.ts` exporting a builder for
  the `agentPolicy` shape: `FactReaders` where `subject()` auto-registers any
  subject as active with an empty group set, `device()` returns compliant,
  `resources(refs)` returns every ref as published, integrity-valid,
  `aclAllows: true`; a `PolicyBundle` marked `signed: true` whose digest
  carries a visible dev marker that **cannot** equal a `sha256:`-prefixed
  production digest, with `evaluate: () => true`; an HMAC
  `DecisionFenceSigner` keyed from the env var. **Reuse the authority
  service's dev implementations if they are exported** — check
  `pdpAdapter.ts` exports first. Do not modify `authority-service/`.
- In `main.ts`, when the flag is `"true"` and `dependencies.agentPolicy` was
  not injected, populate it from `agentDevFacts`. **Throw at startup** if the
  flag is `"true"` and `ORCHESTRATOR_AUTHORITY_PROFILE === "production"` —
  same style as the existing production refusals near line 519. Throw if the
  flag is `"true"` and the signing key is absent.
- `scripts/dev/rag-stack-setup.mjs` writes both vars into
  `.local/rag-stack/orchestrator.env` with a generated dev key, so
  `npm run dev:rag-stack` gets a working agent path. Minimum change.

## Definition of Done — automated

- [ ] `npm run typecheck; echo "exit: $?"` → 0 (never pipe into `tail`/`head`)
- [ ] **`devfacts.production-refuses-flag`** — production profile + flag
      `"true"` → startup throws. The most important test in this module
- [ ] `devfacts.missing-key-refuses` — flag `"true"`, no key → startup throws
- [ ] `devfacts.absent-is-fail-closed` — flag unset → `agentMode` request
      still gets `FORBIDDEN "Agent policy is unavailable."`
- [ ] `devfacts.enabled-wires-replica` — flag + key set → the service
      constructs an `agentHarness`; an `agentMode` request is not rejected as
      unavailable
- [ ] `devfacts.bundle-digest-is-marked` — the dev digest carries the marker
      and can never equal a `sha256:` production digest
- [ ] Existing `orchestrator-service` suite: no new failures. No existing test
      modified

A test that passes by weakening an assertion is a failure, not a completion.

## Definition of Done — manual

- [ ] Start the dev stack per `08-INTEGRATION-TEST-GUIDE.md` Part 1. Send an
      `agentMode: true` request. Confirm it is **not** rejected as unavailable
- [ ] Set `ORCHESTRATOR_AUTHORITY_PROFILE=production` with the flag still
      `"true"`. Confirm the orchestrator **refuses to start**, with a clear
      message. Capture it

## Must NOT change

```
services/**   contracts/**   authority-service/**   server/**
orchestrator-service/src/agentHarness.ts
orchestrator-service/src/agentPdpReplica.ts
orchestrator-service/src/service.ts
```

`main.ts` is open for the additive wiring only; existing production refusals
byte-identical.

## Stop-and-ask — write it down and stop

- The authority service's dev readers aren't exported and mirroring them
  needs more than ~60 lines.
- Wiring requires touching `service.ts` or either protected orchestrator file.
- The dev-stack script makes setting the env vars non-trivial.

## Review packet

Branch `codex/m7-dev-agent-facts`. Provide: diffstat vs parent; protected-path
diffstat (empty); the `main.ts` diff in full; the two env var names and where
the dev stack sets them; full output of every named test with real exit codes;
the production-refusal startup message verbatim; the manual-DoD capture.
