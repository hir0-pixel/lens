import { pathToFileURL } from "node:url";
import { createIndexPublicationClient, IndexPublicationClientError, sanitizePublicationResult } from "../../platform/operators/indexPublicationClient.mjs";

const HELP = `Usage:
  npm run operator:index-publication -- status --corpus <ref> [connection options]
  npm run operator:index-publication -- activate --corpus <ref> --expected-visibility-sequence <n> --target-generation <ref> --source-revision-digest <sha256:...> --governance-revision-digest <sha256:...> --searchable-copy-evidence-ref <ref> --idempotency-key <key> --reason <text> --change-reference <ticket> --fence-file <path> [connection options]
  npm run operator:index-publication -- rollback --corpus <ref> --expected-visibility-sequence <n> --expected-active-generation <ref> --target-generation <ref> --source-revision-digest <sha256:...> --governance-revision-digest <sha256:...> --searchable-copy-evidence-ref <ref> --idempotency-key <key> --reason <text> --change-reference <ticket> --fence-file <path> [connection options]
  npm run operator:index-publication -- refeed --corpus <ref> --expected-visibility-sequence <n> --target-generation <ref> --source-revision-digest <sha256:...> --governance-revision-digest <sha256:...> --idempotency-key <key> --reason <text> --change-reference <ticket> --fence-file <path> [connection options]

Connection options:
  --endpoint <origin>         Publication authority origin-only internal URL
  --ca-file <path>            CA bundle path
  --cert-file <path>          mTLS client certificate path
  --key-file <path>           mTLS client private key path
  --token-file <path>         Optional workload token file path
  --deadline-ms <n>           Absolute request budget in milliseconds (default 10000)
  --allow-loopback-for-tests  Allow loopback HTTP for explicit non-production tests

Environment fallbacks:
  LENS_PUBLICATION_AUTHORITY_URL
  LENS_PUBLICATION_CA_FILE
  LENS_PUBLICATION_CERT_FILE
  LENS_PUBLICATION_KEY_FILE
  LENS_PUBLICATION_TOKEN_FILE
  LENS_PUBLICATION_DEADLINE_MS
`;

function parseArgs(argv) {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    return { help: true };
  }
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const current = rest[index];
    if (!current.startsWith("--")) {
      throw new IndexPublicationClientError("INVALID_ARGUMENT", `Unexpected argument: ${current}`);
    }
    const key = current.slice(2);
    if (key === "allow-loopback-for-tests") {
      options.allowLoopbackForTests = true;
      continue;
    }
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) {
      throw new IndexPublicationClientError("INVALID_ARGUMENT", `Missing value for --${key}`);
    }
    index += 1;
    options[key] = next;
  }
  return { help: false, command, options };
}

function envOrOption(options, env, key, envKey) {
  return options[key] ?? env[envKey];
}

function requireString(name, value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new IndexPublicationClientError("INVALID_ARGUMENT", `${name} is required.`);
  }
  return value.trim();
}

function requireInteger(name, value) {
  const parsed = Number.parseInt(requireString(name, value), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new IndexPublicationClientError("INVALID_ARGUMENT", `${name} must be a non-negative integer.`);
  }
  return parsed;
}

function buildClientOptions(options, env) {
  return {
    endpoint: requireString("endpoint", envOrOption(options, env, "endpoint", "LENS_PUBLICATION_AUTHORITY_URL")),
    caFile: requireString("ca-file", envOrOption(options, env, "ca-file", "LENS_PUBLICATION_CA_FILE")),
    certFile: requireString("cert-file", envOrOption(options, env, "cert-file", "LENS_PUBLICATION_CERT_FILE")),
    keyFile: requireString("key-file", envOrOption(options, env, "key-file", "LENS_PUBLICATION_KEY_FILE")),
    tokenFile: envOrOption(options, env, "token-file", "LENS_PUBLICATION_TOKEN_FILE"),
    deadlineMs: Number.parseInt(envOrOption(options, env, "deadline-ms", "LENS_PUBLICATION_DEADLINE_MS") ?? "10000", 10),
    allowLoopbackForTests: options.allowLoopbackForTests === true,
    productionMode: env.NODE_ENV === "production",
  };
}

function buildCommandInput(command, options) {
  const corpusRef = requireString("corpus", options.corpus);
  if (command === "status") return { method: "status", input: { corpusRef } };
  const mutation = {
    corpusRef,
    expectedVisibilitySequence: requireInteger("expected-visibility-sequence", options["expected-visibility-sequence"]),
    idempotencyKey: requireString("idempotency-key", options["idempotency-key"]),
    reason: requireString("reason", options.reason),
    changeReference: requireString("change-reference", options["change-reference"]),
    fenceFile: requireString("fence-file", options["fence-file"]),
  };
  if (command === "activate") {
    return {
      method: "activate",
      input: {
        ...mutation,
        targetGenerationRef: requireString("target-generation", options["target-generation"]),
        sourceRevisionDigest: requireString("source-revision-digest", options["source-revision-digest"]),
        governanceRevisionDigest: requireString("governance-revision-digest", options["governance-revision-digest"]),
        searchableCopyEvidenceRef: requireString("searchable-copy-evidence-ref", options["searchable-copy-evidence-ref"]),
      },
    };
  }
  if (command === "rollback") {
    return {
      method: "rollback",
      input: {
        ...mutation,
        expectedActiveGenerationRef: requireString("expected-active-generation", options["expected-active-generation"]),
        targetGenerationRef: requireString("target-generation", options["target-generation"]),
        sourceRevisionDigest: requireString("source-revision-digest", options["source-revision-digest"]),
        governanceRevisionDigest: requireString("governance-revision-digest", options["governance-revision-digest"]),
        searchableCopyEvidenceRef: requireString("searchable-copy-evidence-ref", options["searchable-copy-evidence-ref"]),
      },
    };
  }
  if (command === "refeed") {
    return {
      method: "refeed",
      input: {
        ...mutation,
        targetGenerationRef: requireString("target-generation", options["target-generation"]),
        sourceRevisionDigest: requireString("source-revision-digest", options["source-revision-digest"]),
        governanceRevisionDigest: requireString("governance-revision-digest", options["governance-revision-digest"]),
      },
    };
  }
  throw new IndexPublicationClientError("INVALID_ARGUMENT", `Unsupported command: ${command}`);
}

export async function runIndexPublicationCli(argv, {
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  createClient = createIndexPublicationClient,
} = {}) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    stdout.write(`${HELP}\n`);
    return { ok: true, help: true };
  }
  const client = createClient(buildClientOptions(parsed.options, env));
  const { method, input } = buildCommandInput(parsed.command, parsed.options);
  const result = await client[method](input);
  stdout.write(`${JSON.stringify(sanitizePublicationResult(result), null, 2)}\n`);
  return { ok: true, help: false, result };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runIndexPublicationCli(process.argv.slice(2)).catch((error) => {
    const message = error instanceof IndexPublicationClientError ? `${error.code}: ${error.message}` : String(error?.message ?? error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
