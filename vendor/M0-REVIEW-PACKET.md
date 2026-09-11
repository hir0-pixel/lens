# M0 review packet

## Change summary

Tracked `git diff --stat` at completion (new untracked M0 files under `vendor/`
and `tests/` are not included by Git until added):

```text
.npmrc                                         |    2 +-
README.md                                      |    1 +
package-lock.json                              | 3620 +++++++++++++++++-------
package.json                                   |    3 +
platform/build/m00-preflight.mjs               |    2 +-
platform/build/workspace.mjs                   |    4 +-
tests/e2e/ragChat.test.ts                      |    2 +
tests/e2e/ragChatHarness.ts                    |    4 +-
tests/unit/bffRagUiApp.test.tsx                |    5 +
tests/unit/productionConfigPersistence.test.ts |    1 +
10 files changed, 2612 insertions(+), 1032 deletions(-)
```

`git diff --stat -- services server src contracts` produced no output. The
pre-existing `README.md` change is not part of M0.

The lockfile's large textual change is principally the required rewrite of
registry resolution metadata from public npm to the repository's sovereign
mirror. The build policy now admits only tarballs immediately under
`file:vendor/`, in addition to that mirror.

## Automated evidence

- `npm run typecheck`: exit 0 (the explicit shell output was `exit: 0`).
- `npm run lint`: exit 0; 21 existing warnings and no errors.
- `npm test`: exit 0; 79 files and 398 tests passed.
- `npm run validate`: exit 0; typecheck, contracts, provenance, production
  security, 175 Orchestrator tests, 26 Retrieval tests, 36 Authority tests,
  398 root tests, and the production build all passed.
- `npm run test:m0-harness`: exit 0; 5 tests passed.

Focused harness output:

```text
harness.concurrency.isolation: 10 instances, max overlap 10
Test Files  1 passed (1)
Tests       5 passed (5)
```

The five checks cover concurrent isolation, declined compaction, required hook
surface, absence of coding-tool factory calls, and zero socket opens at import.

## Vendored artifacts

- `@earendil-works/pi-agent-core` `0.85.1`
  - integrity: `sha512-hIXIP3eAWueAYiAl8aMvWCvvZ8Q5gT3Dip5bE5uJyIGh4+YlWRjtMLI4BaeoXoSs93zndjue61u1B/vhefLnuA==`
- `@earendil-works/pi-ai` `0.85.1`
  - integrity: `sha512-+VgVIJDkDO2efYJKEEqvPTH4zmnIaXdAppGbO+vKFA9qy5PdhFiAenuFAkU+oiCSfOC4dMHDyrjdQeL4ZoC5CQ==`

The recorded values were verified again against the retained tarballs. The
unpacked core contains `dist/harness/`, and each package contains its upstream
MIT licence. `vendor/` contains neither `pi-coding-agent` nor `pi-tui`.

## What the concurrency test proved

Ten real `AgentHarness` instances executed at the same time, reaching a
measured maximum overlap of ten. Every instance used its own identity marker,
execution environment, session repository, session ID, and JSONL path. After
completion, each transcript, captured context, and on-disk session contained
its own marker and none of the other nine. No shared module-level state or
cross-run visibility was observed under this test.

## Manual requester checks

The source inventory, version, licence, harness directory, prohibited-package
absence, and protected-directory diff were checked during implementation. The
requester should still launch the application and exercise the existing chat
flow by hand, and compare any pre-existing build artifacts if a byte-for-byte
baseline is required.
