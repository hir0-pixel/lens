import { readFileSync, existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const env = {};
for (const line of readFileSync(resolve(root, "server/.env"), "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq < 0) continue;
  env[t.slice(0, eq)] = t.slice(eq + 1);
}
console.log("PUBLICATION", env.PUBLICATION_STORE_PATH, existsSync(env.PUBLICATION_STORE_PATH));
console.log("INGESTION", `${env.INGESTION_STORE_PATH_PREFIX}-enterprise-docs.db`, existsSync(`${env.INGESTION_STORE_PATH_PREFIX}-enterprise-docs.db`));
const pub = new DatabaseSync(env.PUBLICATION_STORE_PATH, { readonly: true });
console.log("corpora", pub.prepare("SELECT * FROM publication_corpora").all());
console.log("gens", pub.prepare("SELECT generation_id, state FROM publication_generations").all());
pub.close();
const ingPath = `${env.INGESTION_STORE_PATH_PREFIX}-enterprise-docs.db`;
if (existsSync(ingPath)) {
  const ing = new DatabaseSync(ingPath, { readonly: true });
  console.log("versions", ing.prepare("SELECT version_ref, state FROM ingestion_versions").all());
  ing.close();
}
