# B4 — Agent Authority Broker: fence ledger and MCP credentials out of process

**Closes the open finding from B1 §7 and M6C.** Read `00-START-HERE.md`,
`B1-FENCE-LEDGER-PACKET.md` §7, `M6C-REVIEW-PACKET.md` (the four inferred
decisions), and Doc 014 / Doc 015 ADR-015-003 on the drive
(`/Volumes/hir0-ssd/Lens/`). Load `ponytail`. Graph before files. No
sub-agents. Branch `codex/b4-authority-broker`.

## Problem

Two things live in the orchestrator — the agent process — that Doc 015
ADR-015-003 says must not: the `FenceLedger` (B1 put a SQLite one in-process
per replica, which is durable but still per-replica), and the MCP secret
store (M6c, `LENS_MCP_SECRET_STORE_KEY`). Because the key is there,
`assertAgentEnvironment` cannot be tightened without breaking MCP. The
orchestrator must hold **refs only**.

## Build

A small HTTP service, `agent-authority-service/`, mirroring
`authority-service/` and `cost-authority-service/` in layout, workload-token
auth, and `main.ts` env conventions. It owns two things and nothing else:

1. **Fence ledger** — `POST /v1/fences/consume { fenceId }` → `{ consumed: true|false }`, atomic first-wins on SQLite unique key. One instance serves every orchestrator replica.
2. **MCP credential resolution** — `POST /v1/mcp/credentials/resolve { credentialRef, executionFence }` → the secret, **only** if the fence is currently valid and unconsumed for that credential's target. The secret store and its key move here. The orchestrator never receives the key.

Then in the orchestrator:
- `FenceLedger` gets an HTTP implementation (`services/pdp/FenceLedger.ts`
  already has the port — add `HttpFenceLedger` beside `InMemory`/`Sqlite`).
- `McpCredentialBroker.resolve` calls the service instead of decrypting
  locally. Remove `LENS_MCP_SECRET_STORE_PATH` / `_KEY` from
  `OrchestratorServiceEnv` and from `loadMcpTools`.
- **Now** extend `assertAgentEnvironment` in `modelTransport.ts` with
  `|| name.endsWith("SECRET_STORE_KEY")`. This is the one protected-file
  change; it's a single predicate and it's the point of the module.
- Under the production profile, both `LENS_AGENT_AUTHORITY_URL` and its
  workload token are required; absent → startup refuses. Dev stack
  (`rag-stack-setup.mjs`) gets the service started and wired like the
  others.

## Holds

- `broker.fence-consume-atomic-across-replicas` — two orchestrator instances,
  one service; second consume of the same fence returns `false`
- `broker.credential-requires-live-fence` — resolve with an expired or
  already-consumed fence → 403; the secret never leaves
- `broker.orchestrator-env-has-no-secret-key` — `assertAgentEnvironment`
  now rejects `*SECRET_STORE_KEY`, and the production orchestrator env
  passes it
- `broker.orchestrator-holds-refs-only` — scan the orchestrator process
  env and every outbound request body it sends: no secret value, ever
- `broker.production-requires-service` — production profile without the
  URL/token → startup throws
- Every existing suite: no new failures vs parent. **Run each package's
  suite from that package's directory** — B2 shipped a bug because it
  didn't.

## Untouched

`services/pdp/PolicyDecisionPoint.ts`, `services/agent-integration/**`
except the one predicate in `modelTransport.ts`, `contracts/**`,
`agentHarness.ts`, `agentPdpReplica.ts`.

## Stop-and-ask

If the credential-resolve endpoint can't verify fence validity without
duplicating PDP logic, stop — the service should *ask* the PDP's ledger, not
re-implement `consumeFence`.

## Packet

`B4-AUTHORITY-BROKER-PACKET.md`: diffstat; protected-path diffstat showing
only the one-line predicate; the service's route table; every named test
with real exit codes; the orchestrator env var list before and after.

---

## Housekeeping — after B4 is audited and merged

Delete the merged remote branches; all are fully in `main`:

```bash
git push origin --delete codex/b1-fence-ledger codex/b2-mcp-dataflow codex/b3-a11y \
  cursor/redundancy-frontend cursor/redundancy-governed-services \
  cursor/redundancy-service-packages cursor/redundancy-tooling
```

Verify first: `git branch -r --no-merged origin/main` must list none of them.
