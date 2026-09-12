import { createHash } from "node:crypto";
import { canonicalJson } from "../security/canonicalJson";

/** `schemaDigest = sha256(canonical JSON of the tool's input schema)` — M6 spec §4b, verbatim.
 * Shared by the admin approval path (pins the digest) and the connector (recomputes it on
 * every call). Using the same canonicalizer as every signer/verifier in the repo means key
 * order in the MCP server's JSON response can never produce a false drift or a false match. */
export function computeSchemaDigest(inputSchema: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalJson(inputSchema)).digest("hex")}`;
}
