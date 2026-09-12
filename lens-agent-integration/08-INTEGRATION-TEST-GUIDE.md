# Integration Test Guide — Prime Agent and MCP

This is the human-run acceptance pass for everything M0–M6 built. Every
module's automated definition of done is green on `main`. What remains is the
**manual** half — the things a person observes with their own eyes — which
were deferred module by module to the point where the whole path could be
exercised. That point is now.

Work through the parts in order. Each scenario states what to do, what you
must observe, and what evidence to capture. Sign-off is the checklist at the
end.

---

## Part 0 — Prerequisite: M7, dev-mode agent policy facts

**You cannot run any scenario in this guide until M7 is merged.** Read this
part first; if `LENS_ORCHESTRATOR_ALLOW_DEV_AGENT_FACTS` doesn't exist in
`orchestrator-service/src/main.ts`, M7 isn't in yet.

### Why

The agent harness runs a `PolicyDecisionPoint` replica in-process
(`orchestrator-service/src/agentPdpReplica.ts`). In production its fact
readers are wired to real IAM / MDM / document-governance systems by the
deployer. Until then, the orchestrator only constructs the harness when
`agentPolicy` is injected — and only tests inject it. On a dev stack, every
`agentMode` request gets:

```
FORBIDDEN: Agent policy is unavailable.
```

That is correct fail-closed behaviour. It also means nobody can test.

### The precedent

`authority-service` has exactly this problem and solves it with
`LENS_AUTHORITY_ALLOW_DEV_FACTS=true` — a dev-only flag that wires a real PDP
against auto-registering readers, **refused at startup under the production
profile**. Read the comment block at `authority-service/src/main.ts:30`; it is
the contract M7 mirrors.

### M7 — definition of done

**Ships:**
- `LENS_ORCHESTRATOR_ALLOW_DEV_AGENT_FACTS` (`"true"` to enable) and
  `LENS_ORCHESTRATOR_DEV_AGENT_SIGNING_KEY` (required when enabled) on
  `OrchestratorServiceEnv`
- `orchestrator-service/src/agentDevFacts.ts` building the `agentPolicy` shape:
  readers that auto-register any subject as active, return devices compliant,
  and publish every resource with `aclAllows: true`; a bundle whose digest
  carries a visible dev marker that can never equal a `sha256:` production
  digest; an HMAC signer from the env key. Reuse `authority-service`'s dev
  implementations if exported
- `main.ts`: populate `agentPolicy` from it when the flag is set and nothing
  was injected. **Throw at startup** if the flag is set under
  `ORCHESTRATOR_AUTHORITY_PROFILE=production`, or if the key is missing
- `scripts/dev/rag-stack-setup.mjs` writes both vars into
  `.local/rag-stack/orchestrator.env` with a generated key

**Holds:**
- `devfacts.production-refuses-flag` — production profile + flag → startup
  throws. **The most important test in M7**
- `devfacts.missing-key-refuses`
- `devfacts.absent-is-fail-closed` — flag unset → still `FORBIDDEN`
- `devfacts.enabled-wires-replica` — flag set → `agentMode` no longer rejected
  as unavailable
- `devfacts.bundle-digest-is-marked`
- Existing orchestrator suite: no new failures

**Untouched:** `services/**`, `contracts/**`, `authority-service/**`,
`server/**`, `orchestrator-service/src/{agentHarness,agentPdpReplica,service}.ts`.
`main.ts` is open for the additive wiring only.

---

## Part 1 — Environment

### Install

The repo's `.npmrc` points at an internal mirror that most machines can't
reach. Use the public recipe:

```bash
npm run install:public
cd server && npm ci --registry=https://registry.npmjs.org/ --prefer-online --ignore-scripts && cd ..
cd orchestrator-service && npm ci --registry=https://registry.npmjs.org/ --prefer-online --ignore-scripts && cd ..
cd runtime-adapter-sidecar && npm ci --registry=https://registry.npmjs.org/ --prefer-online --ignore-scripts && cd ..
cd authority-service && npm ci --registry=https://registry.npmjs.org/ --prefer-online --ignore-scripts && cd ..
```

Then confirm, **without piping into a pager** (you'll read the pager's exit
code and get a false green):

```bash
npm run typecheck; echo "exit: $?"
```

### Known-red baseline

`npm test` has 10 failures that predate all of this work: 8 in
`tests/e2e/ragChat.test.ts` (needs a live retrieval dependency) and 2 in
`tests/unit/bffRagUiApp.test.tsx`. They are not yours and not the agent
work's. Anything else red is a real regression.

### Start the governed stack

`npm run dev:desktop` starts the frontend, BFF and dev IdP only — **no
orchestrator**, so the agent path is unreachable from it alone. You need the
full governed backend:

```bash
npm run rag:setup                          # writes .local/rag-stack/*.env
node scripts/dev/merge-bff-rag-env.mjs
npm run dev:rag-stack                      # authority, runtime sidecar, orchestrator
```

then in a second terminal:

```bash
npm run dev:desktop                        # frontend :1420, BFF :3001, IdP :3005
```

Before starting, set in `.local/rag-stack/runtime.env` a provider the sidecar
can reach. For a lab run, `PROVIDER_PROFILE=development` permits a public
OpenAI-compatible endpoint; production must be `sovereign` with an internal
gateway. **Never commit a populated env file.**

### How opt-in works

There is **no UI toggle yet.** Agent mode is a request-body field on the
existing Ask endpoint:

```
POST /api/rag/ask
{ "query": "...", "conversationRef": "...", "agentMode": true }
```

Omit `agentMode` (or send `false`) and the request takes the legacy one-shot
RAG path, byte-for-byte as before. Send `agentMode: true` to route to the
harness. You'll drive this with an authenticated HTTP client; the smoke
script under `scripts/dev/` shows how to obtain a session against the dev IdP.

A test subject is whatever `sub` the dev IdP issues (fixed to `dev-user-1` in
`dev-idp/server.mjs`). For two-employee scenarios you need two subjects with
**different document entitlements**; with M7's dev facts every subject is
entitled to everything, so entitlement scenarios use the corpus's own
classification instead — see each scenario.

### Where to look

- **Audit log** — the orchestrator's `AuditLedger`; governance events are
  `decision_requested`, `fence_consumed`, `tool_completed`, `tool_blocked`,
  `context_filtered`. They carry `runId`, `toolCallId`, `toolName`, counts.
  **Never arguments, never document text, never resource refs.** If you see
  any of those in a log line, that's a finding — stop and report it.
- **Response `status`** — `COMPLETED`, `INCOMPLETE` (with `incomplete: true`),
  or `DENIED` with output exactly `Not permitted`.

---

## Part 2 — Prime Agent scenarios

### P1 — Default off. Nothing changed.

**Do:** with the full stack up, use the product normally for ten minutes. Ask
questions, get citations. Send a few `POST /api/rag/ask` requests with no
`agentMode` field.

**Observe:** identical behaviour to before this project. No
`decision_requested` events appear in the audit log — the harness was never
constructed for these requests.

**Evidence:** two or three request/response pairs; an audit-log excerpt for
the same window showing no governance events.

### P2 — A real multi-step task completes.

**Do:** ingest three or four short documents on one topic (a policy and a few
things it applies to). Send `agentMode: true` with a task that needs more than
one search — *"Compare each of the X documents against the Y policy and list
conflicts."*

**Observe:** `status: COMPLETED`; an answer with citations; in the audit log,
**per tool call**, the sequence `decision_requested → fence_consumed →
tool_completed`. Count the sequences — they should match the number of
searches the agent made.

**Evidence:** the request, the full response, the audit-log excerpt with the
sequences visible.

### P3 — Forced PDP failure. The agent refuses.

This is the observation M1 has been waiting for since its first packet.

**Do:** stop the orchestrator. Unset
`LENS_ORCHESTRATOR_ALLOW_DEV_AGENT_FACTS` in `orchestrator.env` (or set it to
anything but `"true"`). Restart. Send the same task with `agentMode: true`.

**Observe:** `FORBIDDEN` — the harness is not constructed. Now restore the
flag but corrupt the signing key to a different value than the fences were
issued with; restart; send the task.

**Observe:** `status: DENIED`, output exactly `Not permitted`. In the audit
log: `decision_requested` then `tool_blocked` — and **no** `tool_completed`,
no `fence_consumed`. The block reason contains no document name, no resource
ref, nothing but `Not permitted`.

**Evidence:** both responses; the audit-log excerpt showing the block
sequence; explicit confirmation the reason text is only `Not permitted`.

### P4 — Entitlement. A restricted document stays restricted.

With dev facts every subject is entitled to everything, so this scenario uses
the corpus's classification to create a document the retrieval layer will
withhold.

**Do:** ingest one document with a restricted `classification_ref` that the
default retrieval profile does not include. Send a task whose answer is in
that document.

**Observe:** the answer does not contain the restricted text; citations do not
reference the restricted document; the response does not hint the document
exists — *"No accessible documents matched"* is fine, *"3 documents were
excluded"* is not.

**Evidence:** the response; the restricted document's identifier so an auditor
can confirm it's absent.

### P5 — Envelope. A cut-short run says so.

**Do:** set `LENS_AGENT_MAX_STEPS` (or the orchestrator's `agentMaxSteps`) to
2. Send a task that needs four or five searches.

**Observe:** `status: INCOMPLETE`, `incomplete: true`, output ends with
*"Agent run incomplete."* The response is **distinguishable from a finished
answer** — someone reading it would know not to act on it as complete.

**Evidence:** the response. Then restore the limit.

### P6 — Two people at once.

**Do:** two people, two sessions, both `agentMode: true`, tasks against
different documents, sent simultaneously.

**Observe:** each gets an answer about their own documents. Neither transcript,
answer, or citation set references the other's material. Audit-log `runId`s
are distinct and no event carries the wrong `runId`.

**Evidence:** both responses side by side; the audit-log excerpt.

### P7 — Compaction is declined.

**Do:** a task long enough to approach the context window — many documents,
or a deliberately verbose model. Watch for the run to terminate.

**Observe:** the run ends `INCOMPLETE` rather than continuing with a
summarised transcript. There is no compaction event in the session log.

**Evidence:** the response; confirmation no compaction occurred. If the model
and corpus can't reach the window, note that and mark this scenario as
*not reachable in this lab* rather than passing it.

---

## Part 3 — MCP scenarios

These require M6b merged. They also require a **real internal HTTP MCP
server** — not the test stub — that serves at least one zero-argument tool
and one tool that takes arguments.

### M1 — Registration is admin-only and leaks nothing.

**Do:** as a non-admin session, `POST /api/admin/mcp-servers`. Then as an
admin (a `sub` listed in `ADMIN_SUBJECTS`), register the server with its
endpoint and a `secret_ref`.

**Observe:** non-admin → 403. Admin → `{ id, state }` and **nothing else** — no
endpoint, no `secret_ref` in the response. Discover tools, approve one.

**Evidence:** both responses verbatim.

### M2 — Approved tool runs; unapproved tool doesn't exist.

**Do:** send a task that would use the approved tool. Then a task that would
use a discovered-but-unapproved tool.

**Observe:** first run — audit shows `decision_requested → fence_consumed →
tool_completed` for the MCP tool, and the result reaches the answer. Second
run — the model either can't see the tool or its call is `tool_blocked`;
either way the tool handler on the MCP server is never invoked.

**Evidence:** both responses; the MCP server's own request log showing one
invocation, not two.

### M3 — Revoke the grant. The tool is blocked.

**Do:** disable the tool in the registry (`state: disabled`). Re-run the first
task.

**Observe:** `tool_blocked`, reason `Not permitted`, no network attempt reaches
the MCP server.

**Evidence:** response; MCP server log showing no request.

### M4 — Schema drift is caught.

**Do:** re-enable the tool. On the MCP server, change the tool's input schema
(add a required field). Re-run the task.

**Observe:** `tool_blocked`; the registry shows the tool as `drifted`; the MCP
server's log shows a `tools/list` request but **no `tools/call`**. Re-run
without touching anything.

**Observe:** blocked again, and this time the server log shows **no request at
all** — a drifted tool doesn't get a network attempt.

**Evidence:** registry state; server log across both runs.

### M5 — Arguments are fence-bound.

**Do:** use the tool that takes arguments. Run a task that exercises it.

**Observe:** the MCP server receives the arguments the agent chose, intact.
The audit log shows `toolName` and counts — **not the arguments**.

**Evidence:** server-side received arguments; the audit excerpt proving they
aren't logged.

### M6 — Provenance controls what reaches the model.

**Do:** approve a `resource-gated` tool whose results carry resource refs at
the declared JSON path. Run a task. Then point the provenance path at a field
the server doesn't return, re-approve, run again.

**Observe:** first run — the tool's content appears in the answer. Second run
— the answer does not contain the tool's content; the audit log shows
`context_filtered` with a non-zero `dropped` count. A `tool-gated` tool the
subject holds is unaffected by either.

**Evidence:** both responses; the `context_filtered` event.

### M7 — Credentials never appear anywhere.

**Do:** during any MCP scenario, capture the orchestrator's process
environment and the audit log.

**Observe:** the MCP server's secret value appears in neither. Only a
`credentialRef`.

**Evidence:** the scan output.

---

## Part 4 — Sign-off

Every row needs evidence attached. "Ran it, looked fine" is not evidence.

| # | Scenario | Pass | Evidence |
|---|---|---|---|
| P1 | Default off — nothing changed | ☐ | |
| P2 | Multi-step task completes | ☐ | |
| P3 | Forced PDP failure refuses | ☐ | |
| P4 | Restricted document stays restricted | ☐ | |
| P5 | Cut-short run is marked incomplete | ☐ | |
| P6 | Concurrent employees isolated | ☐ | |
| P7 | Compaction declined | ☐ / not reachable | |
| M1 | Registration admin-only, no leak | ☐ | |
| M2 | Approved runs, unapproved absent | ☐ | |
| M3 | Revoked grant blocks | ☐ | |
| M4 | Schema drift caught, no retry traffic | ☐ | |
| M5 | Arguments fence-bound, not logged | ☐ | |
| M6 | Provenance gates content | ☐ | |
| M7 | Credentials absent everywhere | ☐ | |

**Anything that fails goes back as a review packet against the module that
owns it**, not as a patch. The module docs say which paths each module may
touch; that still holds.

## What this guide doesn't cover — and shouldn't be claimed

- **Real IAM / MDM / document-governance facts.** M7's dev facts make every
  subject entitled to everything. Entitlement is proven in the automated
  suites with injected readers; here it's exercised through corpus
  classification only. Production evidence for real readers is a deployment
  gate, per the handoff.
- **Sovereign provider.** A lab run uses `PROVIDER_PROFILE=development`.
  Production requires `sovereign` with an internal gateway.
- **A UI for agent mode.** It's API-only. That's a product gap, tracked for
  the design review, not a test gap.
