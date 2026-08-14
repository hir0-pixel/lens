# Sovereign service template

Copy this directory only when creating a new deployable service. A service owns
its own API implementation, state, migrations, and operational runbook; it must
not import another service's internals or access another service's datastore.

Before a template becomes executable, its owner must replace every placeholder
with a digest-pinned internal artifact and add its contracts, health checks,
bounded-resource settings, telemetry redaction rules, migrations, and test
evidence. The template never grants a release signature, production credential,
or network egress.
