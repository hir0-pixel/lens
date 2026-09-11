# M5 Routing Seam Review Packet

## Harness construction site

The complete canonical construction site is `orchestrator-service/src/agentHarness.ts`,
starting at `createProductionAgentHarness`. It performs, in one place and before a run:

- `assertAgentEnvironment(...)`
- `AgentRuntime.registerTool(searchCorpusCatalogEntry)`
- `models.setProvider(...)` using `createLensAgentProvider(...)`
- per-run `createSearchCorpusTool(...)` scope from the authenticated request
- `bindToolGovernance(...)`
- `bindContextAuthorization(...)`
- `bindCompactionDecline(...)`
- `AgentRuntime.begin(...)` with step, cost, and deadline limits

`ProductionOrchestratorService` constructs that factory once after its existing
`ModelGateway` is built. No provider or HTTP client is constructed in agent-integration.

## PDP replica evidence

- `routing.pdp-bundle-matches-retrieval`: PASS; the agent replica is activated with
  the exact bundle object captured from retrieval activation, and both decisions report
  its `sha256:policy-v1` digest.
- `routing.pdp-agrees-with-retrieval`: PASS for matching subject, device, and resource
  facts across a mixed authorized/unauthorized resource set.
- `routing.pdp-decisions-audited`: PASS; `decideBatch` call count equals admitted
  `pdp.decision` ledger event count across the agent flow.

Production receives the exact `FactReaders`, signed `PolicyBundle`, and signer through
the same deployer-integration pattern used by the other production authority adapters.
If they are absent, agent mode is unavailable and fails closed. Fences are issued and
consumed by the same process-local PDP instance during one HTTP request; the current
request topology cannot migrate a live run between orchestrator replicas.

## Forced PDP failure audit excerpt

Automated evidence from `routing.forced-pdp-failure` (`request-25`):

```text
workload=orchestrator-agent-harness action=decision_requested tool=search_corpus
workload=orchestrator-agent-pdp     action=agent.tool.search_corpus allowed=0
workload=orchestrator-agent-harness action=tool_blocked tool=search_corpus
response.status=DENIED response.output="Not permitted" retrieval_calls=0
```

The allow-path tests additionally assert the ordering represented by
`decision_requested`, `fence_consumed`, and `tool_completed`. Ledger payloads contain
run/tool identifiers and counts only, never resource references or document text.

## Automated results

```text
npm run typecheck
exit: 0

npm run lint
exit: 0 (existing warnings only)

M5 orchestrator suite: 14 passed
M5 BFF suite:           3 passed
M5 compaction suite:    1 passed
Focused total:         18 passed
Concurrent sessions:  10
```

Concurrency agrees with M0: ten simultaneous requests retained distinct subjects,
sessions, retrieval results, and outputs.

`npm run validate` passes typecheck, contracts, provenance, the production security
gate, and all orchestrator/retrieval/authority service suites. It exits 1 in the root
test phase on the existing dirty-tree failures in `bffRagUiApp.test.tsx` and
`ragChat.test.ts`, which reproduce on detached `origin/main` at `8bd1622`. The local
workspace also has `INGESTION_USE_LOCAL_EMBEDDINGS` state that makes
`productionConfigPersistence.test.ts` fail; that test passes in the detached clean
parent. No M5 source appears in any failing stack.

## Protected paths

```text
git diff --cached --stat -- services/agent-runtime services/pdp services/retrieval contracts \
  services/agent-integration/governanceBinding.ts \
  services/agent-integration/contextBinding.ts \
  services/agent-integration/corpusTool.ts \
  services/agent-integration/modelTransport.ts

(empty)
```

No existing test file was modified. All M5 coverage is in new test files.

## Manual status

The real-provider app exercise was not fabricated locally. It requires deployment to
inject the live IAM/MDM/document `FactReaders`, the identical signed retrieval policy
bundle, and the real provider configuration. Until those are supplied, opt-in requests
fail closed as designed. The automated harness uses the production construction path
and covers multi-step execution, forced PDP denial, differing entitlements, ten-way
concurrency, all three envelope limits, explicit incomplete responses, and flag-off
body identity.
