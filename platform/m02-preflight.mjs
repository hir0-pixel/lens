#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = ["services/identity-sync/authority-schema.json", "services/audit/ledger-schema.json", "services/session/session-schema.json"];
function fail(message) { console.error(`M02 preflight: ${message}`); process.exit(1); }
const read = (file) => { const absolute = path.join(root, file); if (!existsSync(absolute)) fail(`missing ${file}`); return JSON.parse(readFileSync(absolute, "utf8")); };
const [identity, audit, session] = files.map(read);
if (identity.transaction !== "serializable-state-cursor-revision-outbox" || identity.publicDirectoryRuntimeDependency !== false || !identity.securityFactStates.includes("recompute_pending")) fail("identity authority permits stale or non-atomic security facts.");
if (audit.appendOnly !== true || audit.partitions !== 64 || audit.replicasPerPartition !== 5 || audit.writeQuorum !== 3 || audit.placement !== "2-2-1-independent-failure-domains" || audit.maximumEventBytes !== 65536 || audit.witnesses?.minimum < 2 || audit.drCheckpointMaxSeconds !== 60 || audit.acceptedEventDrops !== 0) fail("audit ledger violates quorum, witness, or durability controls.");
if (session.strongReplicatedState !== true || session.opaqueSessionIds !== true || session.deviceBound !== true || session.clientKeyBound !== true || session.authorizationFactsInContext !== false || session.sessionMutationsRequireAuditAdmission !== true || session.outbox !== true) fail("session authority permits unbound, unaudited, or authorizing session state.");
console.log("M02 Engineer A authority preflight passed.");
