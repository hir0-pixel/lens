import { SqliteProviderRegistry } from "../../services/provider-registry/ProviderRegistry.ts";

const path = process.argv[2] ?? "E:/Orchids/lens/.local/rag-stack/data/providers.sqlite";
const registry = new SqliteProviderRegistry(path);
const models = await registry.approvedSnapshot();
console.log(JSON.stringify(models, null, 2));
