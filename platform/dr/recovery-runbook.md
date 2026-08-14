# M10-A recovery runbook

1. Security Operations supplies a signed, audit-admitted incident declaration. The coordinator sends only exact scoped requests to each owner; it does not hold a universal mutation identity.
2. Fence the failed generation before any former primary can rejoin. Use the declared odd-voter topology and do not treat DNS or load-balancer movement as authority.
3. Select encrypted backup sets under a privileged-change fence and independent approval. Backup operators move ciphertext only; they do not decrypt or inspect records.
4. Restore in the separate-trust cell. It has no public, corporate, production-data-plane, or export route; its images are ephemeral and currently admitted.
5. Verify Audit continuity, Secrets recovery manifest and current revocation/key epochs, owner authority heads, known-good admitted artifacts, re-attestation, frozen ambiguous work, owner reconciliation, and abuse regression evidence. A Class A checkpoint older than 60 seconds blocks recovery admission.
6. Reopen traffic only with verified evidence and a target-side traffic-gate receipt. After signed acceptance, zeroize the cell and plaintext keys; quarantine it if cleanup cannot be proven.
