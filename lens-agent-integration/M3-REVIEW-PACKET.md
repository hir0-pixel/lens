# M3 Review Packet

## Identity trace

1. The authenticated request supplies `subjectRef` to the agent run scope.
2. `CreateSearchCorpusToolOptions.scope.subjectRef` captures that exact run identity; the tool schema exposes only `query`, so model arguments cannot replace or widen it.
3. `createSearchCorpusTool.execute` copies it unchanged into `RetrievalRequest.subject_ref`.
4. `CorpusRetrievalPort.retrieve(request, signal)` invokes the existing retrieval ingress.
5. `RetrievalService.retrieve` forwards `request.subject_ref` to both `authorizeOperation.subjectRef` and `authorizeBatch.subjectRef` before protected content is fetched.

The separate M1 corpus gate uses `resolveSearchCorpusIntent(profile, selector)`, which returns `agent.tool.search_corpus` and the server-owned profile's `corpusRef`. Retrieval remains responsible for document-level authorization.

## Two-employee evidence

The `corpus.scoped-to-employee` test runs the same `terms` query over candidates containing both documents:

| Employee | Returned excerpt | Absent excerpt |
| --- | --- | --- |
| `employee-a` | `Employee A private refund terms` | Employee B acquisition terms |
| `employee-b` | `Employee B confidential acquisition terms` | Employee A refund terms |

Both paths execute the production `RetrievalService`; its batch PDP fixture allows a different document-version ref for each employee.
