# M4 Context Binding Review Packet

## Scope

`bindContextAuthorization` filters `toolResult` messages in the Prime Agent
`transform_context` hook. It batches the unique resource refs into one PDP
decision for the employee subject, then keeps a result only when every one of
its refs is allowed. Unbacked and partially authorised results have their
original content discarded wholesale and are replaced with a structurally
valid `[withheld]` tool-result stub before `modelTransport` assembles the
provider payload.

If the PDP or count-only log port fails, the hook replaces the request context
with a private blocked sentinel. The Lens provider consumes that sentinel and
returns `Not permitted` without contacting the model gateway.

## Captured Model Payload

Mixed input:

- allowed: `document-allowed`, text `Allowed refund policy.`
- excluded: `document-denied`, text `Restricted acquisition plan.`

Actual second-request message payload captured by
`context.only-allowed-text`:

```json
[
  { "role": "system", "content": "Lens system prompt without document text" },
  { "role": "user", "content": "Compare the policies without embedding document text" },
  { "role": "assistant", "content": "", "toolCalls": [
    { "id": "call-allowed", "name": "search_corpus", "arguments": "{\"resourceRef\":\"document-allowed\"}" },
    { "id": "call-denied", "name": "search_corpus", "arguments": "{\"resourceRef\":\"document-denied\"}" }
  ] },
  { "role": "tool", "content": "Allowed refund policy. [document-allowed]", "toolCallId": "call-allowed" },
  { "role": "tool", "content": "[withheld]", "toolCallId": "call-denied" }
]
```

The excluded text is absent, while the stub keeps every assistant tool call
paired with a tool result. Its source `details` are `{ "resourceRefs": [] }`
before transport mapping. The tool-call argument retains the requested ref as
conversation protocol, but no excluded document content or citation enters the
model payload.

## Verification

- M4, M1, M2, and one-shot RAG focused suites: 32/32 passed.
- M4 suite, including `context.transcript-stays-valid`: 10/10 passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed with 21 existing warnings and no errors.
- Orchestrator service: 175/175 passed.
- Retrieval service: 26/26 passed.
- Authority service: 36/36 passed.
- M0 harness: 5/5 passed in isolation.
- Full gate introduced no failures beyond the parent failures identified by the owner. The RAG e2e remains dependency-unavailable in this local environment.
- Protected-path diff is empty for `services/pdp`, `services/retrieval`, `services/orchestrator/RagComposition.ts`, and `contracts`.
