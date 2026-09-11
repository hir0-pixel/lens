# M1 governance binding review packet

Status: automated definition of done and the corrected driven manual evidence
pass. App-level observation moves to M5, where the harness becomes reachable
from the UI.

## Scope

- `services/agent-integration/governanceBinding.ts` binds `before_tool` and
  `after_tool`, consumes a single-use `tool_boundary` fence before execution,
  fails closed with the generic reason `Not permitted`, and exports the
  throwaway `echo` tool.
- `tests/integration/m01-governance-binding.test.ts` contains the nine M1
  acceptance cases.
- `package.json` and `package-lock.json` declare the directly imported
  `typebox` runtime dependency at exact version `1.3.7`.

## Diff checks

The repository already contained unrelated and M0 changes when M1 began, so
the whole-working-tree stat includes those changes. The M1 source and test add
457 lines before formatting/stat metadata.

```text
git diff --stat
.npmrc                                         |    2 +-
README.md                                      |    1 +
package-lock.json                              | 3621 +++++++++++++++++-------
package.json                                   |    4 +
platform/build/m00-preflight.mjs               |    2 +-
platform/build/workspace.mjs                   |    4 +-
tests/e2e/ragChat.test.ts                      |    2 +
tests/e2e/ragChatHarness.ts                    |    4 +-
tests/unit/bffRagUiApp.test.tsx                |    5 +
tests/unit/productionConfigPersistence.test.ts |    1 +
10 files changed, 2614 insertions(+), 1032 deletions(-)

git diff --stat -- services/pdp services/retrieval services/model-provider contracts
(no output)
```

No forbidden M1 path was modified.

## Automated evidence

Run on 2026-09-11 from `E:\Orchids\lens`:

```text
npm run typecheck
exit 0

npm run lint
exit 0 (21 existing warnings, 0 errors)

npm test
Test Files  80 passed (80)
Tests       407 passed (407)
exit 0

npm run validate
Orchestrator: 21 files, 175 tests passed
Retrieval:    3 files, 26 tests passed
Authority:    4 files, 36 tests passed
Root:         80 files, 407 tests passed
Production build completed
All quality gates passed.
exit 0
```

The first aggregate validation attempt encountered the repository's
intermittent RAG e2e `DEPENDENCY_UNAVAILABLE` result. The immediately preceding
full suite passed, and two subsequent complete `npm run validate` executions
passed. No M1 test failed in any run.

Each required name was also run individually and exited 0:

```text
pdp.tool.denied-blocks                 1 passed, 8 skipped
pdp.tool.allowed-proceeds              1 passed, 8 skipped
pdp.tool.fail-closed                   2 passed, 7 skipped
pdp.tool.fence-replay-rejected         1 passed, 8 skipped
pdp.tool.every-call-decided            1 passed, 8 skipped
pdp.tool.digest-stable                 1 passed, 8 skipped
pdp.tool.log-ordering                  1 passed, 8 skipped
```

The complete command output is retained in the Codex task transcript that
produced this packet.

## Digest derivation

`normalizedContextDigest` is `sha256:` plus the lowercase hexadecimal SHA-256
of a canonical JSON object containing exactly `{ toolName, args }`. Object keys
are sorted recursively, array order is preserved, JSON primitive encoding is
used, and non-finite numbers are rejected. Thus object insertion order does not
change the digest, while changing the tool name or any argument does.

## Driven manual evidence

Commands:

```text
npm run evidence:m1-governance -- healthy
npm run evidence:m1-governance -- throwing
```

Attached output:

- `evidence/m1-governance-healthy.txt`
- `evidence/m1-governance-throwing.txt`

The healthy run shows decision request, fence consumption, and completion in
order. The throwing-reader run shows only decision request and the generic
`Not permitted` block. The script asserts one healthy execution and zero
throwing-PDP executions. Neither the typed log event nor either attachment
contains tool arguments or resource references.

Starting the app and observing a real routed task is intentionally deferred to
M5; no temporary debug entrypoint or action was added.
