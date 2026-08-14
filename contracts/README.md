# M00 Contract Registry

This registry is the M00 Engineer B boundary. It publishes shared API, event,
error, and compatibility metadata; it does not own domain decisions or service
state.

`npm run generate` produces the TypeScript client surface in
`libs/generated-clients`. The generated client is exercised only against the
deterministic owner simulator in `libs/testkit` until a real owner service is
introduced.

Contract changes are additive within `v1`. Breaking changes require a new
major contract and an explicit compatibility entry.
