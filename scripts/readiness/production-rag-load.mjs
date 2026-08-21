#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { printUsage, ProductionRagLoadError, runFromCli } from "./production-rag-load-lib.mjs";

async function main() {
  try {
    const result = await runFromCli();
    if (result?.help) {
      console.log(printUsage());
      return;
    }
    console.log(JSON.stringify(result, null, 2));
    if (result.pass !== true) process.exitCode = 1;
  } catch (error) {
    if (error instanceof ProductionRagLoadError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
