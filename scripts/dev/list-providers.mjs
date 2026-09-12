import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SqliteProviderRegistry } from "../../services/provider-registry/ProviderRegistry.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const path = process.argv[2] ?? resolve(root, ".local/rag-stack/data/providers.sqlite");
const registry = new SqliteProviderRegistry(path);
const models = await registry.approvedSnapshot();
console.log(JSON.stringify(models, null, 2));
