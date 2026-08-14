# M01 Local And Integration Packaging

This package is deliberately a policy fixture, not a production deployment.
It declares default-deny egress, attestation-backed short-lived lease inputs,
and an internal-only telemetry collector target. Engineer A supplies the
network, PKI, workload identity, attestation, and secrets authorities that
enforce these declarations at runtime.
